"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "../../components/ui/button";

export default function LoginPage() {
  const [state, setState] = useState<"default" | "loading" | "error">("default");
  useEffect(() => { const query = new URLSearchParams(window.location.search); if (query.has("error")) setState("error"); else if (query.has("pending")) setState("loading"); }, []);
  function signIn() {
    setState("loading");
    const returnUrl = new URL("/", window.location.origin).toString();
    window.location.assign(`/.auth/login/github?post_login_redirect_uri=${encodeURIComponent(returnUrl)}`);
  }

  return <main className="login-page">
    <section aria-label="About Infographics" className="login-page__intro">
      <p className="wordmark">Infographics</p>
      <p>This private notebook is available to its owner.</p>
      <a className="login-public-link" href="/view/">View public collection<ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.75} /></a>
    </section>
    <section aria-labelledby="login-title" className="login-panel">
      <h1 id="login-title">Sign in</h1>
      {state === "error" ? <p aria-live="polite" className="error-copy">We could not sign you in. Try again.</p> : null}
      <Button disabled={state === "loading"} onClick={signIn}>{state === "loading" ? "Signing in…" : "Continue with GitHub"}</Button>
      {state === "error" ? <Button onClick={signIn} variant="secondary">Try again</Button> : null}
    </section>
  </main>;
}
