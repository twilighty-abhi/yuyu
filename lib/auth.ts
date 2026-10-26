import "server-only";

import NextAuth, { CredentialsSignin } from "next-auth";
import { authAdapter } from "@/lib/authAdapter";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import { hasVerifiedGoogleEmail } from "@/lib/googleAuth";
import { verifyPasswordCredentials } from "@/lib/credentialsAuth";
import { evaluateGoogleSignIn, loadGoogleSsoSettings } from "@/lib/googleSignIn";
import { logAuthError } from "@/lib/authLogger";

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

// The config callback runs for every Auth.js request, `auth()` call and
// server-side signIn/signOut, so Google SSO follows the instance settings
// stored in the database at request time (no restart or rebuild). When Google
// is removed the provider disappears and its sign-in/callback routes stop.
export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const google = await loadGoogleSsoSettings();
  return {
  adapter: authAdapter,
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
  logger: {
    // Expected sign-in outcomes are skipped; see lib/authLogger.ts.
    error: logAuthError,
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    ...(google
      ? [
          Google({
            clientId: google.clientId,
            clientSecret: google.clientSecret,
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
        // Shared with mobile sign-in (lib/credentialsAuth.ts).
        const result = await verifyPasswordCredentials(raw);
        if (result.ok) return result.user;
        if (result.reason === "email_verification_required") throw new EmailVerificationRequiredError();
        if (result.reason === "mfa_required") throw new MfaRequiredError();
        return null;
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;
      const email = user.email?.trim().toLowerCase();
      // Shared with mobile Google sign-in (lib/googleSignIn.ts).
      const decision = await evaluateGoogleSignIn({
        email,
        emailVerified: hasVerifiedGoogleEmail(profile),
        providerAccountId: account.providerAccountId,
      });
      if (decision === "deny") return false;
      user.email = email;
      // Returning true lets Auth.js create the adapter user after this callback.
      if (decision === "account_creation_disabled") return "/login?error=account_creation_disabled";
      return true;
    },
    async jwt({ token, user }) {
      const userId = user?.id ?? token.sub;
      if (!userId) return null;

      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { sessionVersion: true },
      });
      if (!currentUser) return null;

      const sessionToken = token as typeof token & { authenticatedAt?: number; sessionVersion?: number; sessionRevoked?: boolean };
      if (user) {
        // Bind credentials to the version checked with the password. A reset
        // racing token issuance must not mint a fresh session from old proof.
        const verifiedVersion = (user as typeof user & { sessionVersion?: number }).sessionVersion;
        if (verifiedVersion !== undefined && verifiedVersion !== currentUser.sessionVersion) return null;
        token.sub = user.id;
        sessionToken.authenticatedAt = Date.now();
        sessionToken.sessionVersion = currentUser.sessionVersion;
        sessionToken.sessionRevoked = false;
      } else if (sessionToken.sessionRevoked || sessionToken.sessionVersion !== currentUser.sessionVersion) {
        // Auth.js clears the cookie and returns a genuinely anonymous session.
        return null;
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
  };
});
