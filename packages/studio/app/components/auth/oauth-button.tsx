"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";

import { GitHubIcon } from "@/app/components/landing/icons";
import { Button } from "@/app/components/ui/button";
import { githubAuthUrl } from "@/lib/api";

/*
 * Starts the existing gateway GitHub OAuth flow. This must be a full-page
 * navigation (not a fetch): the gateway sets the `oauth_state` cookie and
 * 302-redirects to GitHub.
 */
export function OAuthButton() {
  const [redirecting, setRedirecting] = useState(false);

  function handleClick() {
    if (redirecting) return;
    setRedirecting(true);
    window.location.assign(githubAuthUrl());
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="w-full rounded-lg text-muted-foreground"
      onClick={handleClick}
      disabled={redirecting}
      aria-busy={redirecting}
    >
      {redirecting ? (
        <LoaderCircle className="animate-spin" aria-hidden="true" />
      ) : (
        <GitHubIcon />
      )}
      {redirecting ? "Redirecting to GitHub…" : "Continue with GitHub"}
    </Button>
  );
}
