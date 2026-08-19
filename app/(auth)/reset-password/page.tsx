import type { Metadata } from "next";
import { ResetPasswordForm } from "./ui";

export const metadata: Metadata = {
  title: "Reset Password",
  description: "Set a new password for your Yuyu account.",
};

type Props = {
  searchParams: Promise<{ token?: string; email?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: Props) {
  const sp = await searchParams;
  const token = sp.token ?? "";
  const email = sp.email ?? "";

  return <ResetPasswordForm token={token} email={email} />;
}
