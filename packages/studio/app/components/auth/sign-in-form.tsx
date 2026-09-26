"use client";

import { useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

import { AuthError } from "@/app/components/auth/auth-error";
import { AuthField } from "@/app/components/auth/auth-field";
import { OAuthButton } from "@/app/components/auth/oauth-button";
import { Button } from "@/app/components/ui/button";
import { LoaderCircle } from "lucide-react";
import { signin } from "@/lib/api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // OAuth failures come back as ?error=oauth_failed on the redirect target.
  const oauthError = searchParams.get("error");
  const oauthErrorMessage = oauthError
    ? oauthError === "oauth_failed"
      ? "GitHub sign-in failed. Please try again."
      : "Sign-in failed. Please try again."
    : null;
  const visibleError = formError ?? oauthErrorMessage;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) {
      errors.email = "Email is required.";
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      errors.email = "Invalid email address.";
    }
    if (!password) {
      errors.password = "Password is required.";
    }

    setFieldErrors(errors);
    if (errors.email) {
      emailRef.current?.focus();
      return;
    }
    if (errors.password) {
      passwordRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await signin(email.trim(), password);
      router.push("/");
      router.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <OAuthButton />

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-faint">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {visibleError ? <AuthError>{visibleError}</AuthError> : null}

        <AuthField
          ref={emailRef}
          id="signin-email"
          name="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />

        <AuthField
          ref={passwordRef}
          id="signin-password"
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
        />

        <Button
          type="submit"
          size="lg"
          className="w-full rounded-lg"
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>
    </div>
  );
}
