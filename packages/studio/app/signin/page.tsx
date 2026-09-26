import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuthLayout } from "@/app/components/auth/auth-layout";
import { SignInForm } from "@/app/components/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in | Klinpi",
  description: "Sign in to your Klinpi workspace.",
};

export default function SignInPage() {
  return (
    <AuthLayout
      title="Sign in"
      subtitle="Sign in to your Klinpi workspace."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-foreground underline-offset-4 transition-opacity duration-[150ms] hover:underline hover:opacity-80"
          >
            Sign up
          </Link>
        </>
      }
    >
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </AuthLayout>
  );
}
