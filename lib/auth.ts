import NextAuth, { CredentialsSignin } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hasVerifiedGoogleEmail } from "@/lib/googleAuth";
import { decryptMfaSecret, hashRecoveryCode, verifyMfaCode } from "@/lib/mfa";
import { isNewUserRegistrationEnabled } from "@/lib/instanceSettings";

const googleId = process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID;
const googleSecret =
  process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  totp: z.string().trim().max(32).optional(),
});

/**
 * This code is returned only after the supplied password is valid. It lets the
 * sign-in screen show the second factor as a distinct step without exposing
 * whether an arbitrary email address has MFA enabled.
 */
class MfaRequiredError extends CredentialsSignin {
  code = "mfa_required";
}

class EmailVerificationRequiredError extends CredentialsSignin {
  code = "email_verification_required";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Credentials requires JWT sessions; OAuth accounts are still persisted
  // via the adapter's `linkAccount` hook.
  session: { strategy: "jwt" },
  // Changing the session payload/secret can leave an old encrypted cookie in
  // browsers. A versioned name retires that incompatible token cleanly rather
  // than asking Auth.js to decode it on every request.
  cookies: {
    sessionToken: { name: "yuyu.session-token.v2" },
  },
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    ...(googleId && googleSecret
      ? [
          Google({
            clientId: googleId,
            clientSecret: googleSecret,
            // Existing password users can use the same verified Google email.
            // This is deliberately scoped to Google, never arbitrary providers.
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    Credentials({
      id: "credentials",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            passwordHash: true,
            emailVerified: true,
            mfaSecretEncrypted: true,
            recoveryCodeHashes: true,
          },
        });
        if (!user?.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;
        if (!user.emailVerified) throw new EmailVerificationRequiredError();

        if (user.mfaSecretEncrypted) {
          const code = parsed.data.totp ?? "";
          if (!user.email) return null;
          if (!code) throw new MfaRequiredError();
          const validTotp = verifyMfaCode(decryptMfaSecret(user.mfaSecretEncrypted), user.email, code);
          const recoveryHash = hashRecoveryCode(code);
          const validRecovery = user.recoveryCodeHashes.includes(recoveryHash);
          if (!validTotp && !validRecovery) return null;
          if (validRecovery) {
            await prisma.user.update({
              where: { id: user.id },
              data: { recoveryCodeHashes: { set: user.recoveryCodeHashes.filter((hash) => hash !== recoveryHash) } },
            });
          }
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;
      if (!hasVerifiedGoogleEmail(profile)) return false;
      if (!(await isNewUserRegistrationEnabled())) {
        const existingAccount = await prisma.account.findUnique({
          where: { provider_providerAccountId: { provider: account.provider, providerAccountId: account.providerAccountId } },
          select: { id: true },
        });
        if (!existingAccount) {
          const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
          const existingUser = email ? await prisma.user.findUnique({ where: { email }, select: { id: true } }) : null;
          // Existing password users may still link their verified Google identity.
          if (!existingUser) return false;
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      const userId = user?.id ?? token.sub;
      if (!userId) return token;

      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { sessionVersion: true },
      });
      if (!currentUser) {
        (token as typeof token & { sessionRevoked?: boolean }).sessionRevoked = true;
        return token;
      }

      const sessionToken = token as typeof token & { authenticatedAt?: number; sessionVersion?: number; sessionRevoked?: boolean };
      if (user) {
        token.sub = user.id;
        sessionToken.authenticatedAt = Date.now();
        sessionToken.sessionVersion = currentUser.sessionVersion;
        sessionToken.sessionRevoked = false;
      } else if (sessionToken.sessionVersion !== currentUser.sessionVersion) {
        sessionToken.sessionRevoked = true;
      }
      return token;
    },
    session({ session, token }) {
      const sessionToken = token as typeof token & { authenticatedAt?: number; sessionRevoked?: boolean };
      if (session.user && token.sub && !sessionToken.sessionRevoked) session.user.id = token.sub;
      if (sessionToken.sessionRevoked && session.user) session.user.id = "";
      (session as typeof session & { authenticatedAt?: number }).authenticatedAt =
        sessionToken.authenticatedAt;
      return session;
    },
  },
  events: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        // Auth.js creates or links the adapter user after callbacks.signIn.
        await prisma.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
      }
    },
  },
});
