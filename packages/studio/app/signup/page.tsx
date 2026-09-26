import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuthLayout } from "@/app/components/auth/auth-layout";
import { SignUpForm } from "@/app/components/auth/sign-up-form";

export const metadata: Metadata = {
  title: "Sign up | Klinpi",
  description: "Create a Klinpi account and start handing tasks to your AI engineer.",
};

export default function SignUpPage() {
  return (
    <AuthLayout
      title="Sign up"
      subtitle="Create an account to start building with Klinpi."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/signin"
            className="font-medium text-foreground underline-offset-4 transition-opacity duration-[150ms] hover:underline hover:opacity-80"
          >
            Sign in
          </Link>
        </>
      }
    >
      <Suspense fallback={null}>
        <SignUpForm />
      </Suspense>
    </AuthLayout>
  );
}
