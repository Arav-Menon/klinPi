/*
 * Form-level error banner. `role="alert"` announces the message as soon as
 * it appears (server errors, OAuth failures, rate limits). The reveal uses
 * the CSS animation from globals.css, so prefers-reduced-motion disables it.
 */
export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="auth-reveal auth-reveal-fast rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-danger"
    >
      {children}
    </p>
  );
}
