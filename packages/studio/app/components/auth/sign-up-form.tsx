"use client";

import { useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import { AuthError } from "@/app/components/auth/auth-error";
import { AuthField } from "@/app/components/auth/auth-field";
import { OAuthButton } from "@/app/components/auth/oauth-button";
import { Button } from "@/app/components/ui/button";
import { signup } from "@/lib/api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_NAME_LENGTH = 100;
const MAX_PASSWORD_LENGTH = 128;

export function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // OAuth failures come back as ?error=oauth_failed on the redirect target.
  const oauthError = searchParams.get("error");
  const oauthErrorMessage = oauthError
    ? oauthError === "oauth_failed"
      ? "GitHub sign-in failed. Please try again."
      : "Sign-up failed. Please try again."
    : null;
  const visibleError = formError ?? oauthErrorMessage;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const errors: { name?: string; email?: string; password?: string } = {};

    if (!trimmedName) {
      errors.name = "Name is required.";
    } else if (trimmedName.length > MAX_NAME_LENGTH) {
      errors.name = `Name must be at most ${MAX_NAME_LENGTH} characters.`;
    }
    if (!trimmedEmail) {
      errors.email = "Email is required.";
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      errors.email = "Invalid email address.";
    }
    if (!password) {
      errors.password = "Password is required.";
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    } else if (password.length > MAX_PASSWORD_LENGTH) {
      errors.password = `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
    }

    setFieldErrors(errors);
    if (errors.name) {
      nameRef.current?.focus();
      return;
    }
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
      await signup(trimmedName, trimmedEmail, password);
      router.push("/");
      router.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Sign-up failed. Please try again.");
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
          ref={nameRef}
          id="signup-name"
          name="name"
          label="Name"
          type="text"
          autoComplete="name"
          placeholder="Your name"
          maxLength={MAX_NAME_LENGTH}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldErrors.name}
        />

        <AuthField
          ref={emailRef}
          id="signup-email"
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
          id="signup-password"
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="Create a password"
          maxLength={MAX_PASSWORD_LENGTH}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
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
              Creating account…
            </>
          ) : (
            "Create account"
          )}
        </Button>
      </form>
    </div>
  );
}
