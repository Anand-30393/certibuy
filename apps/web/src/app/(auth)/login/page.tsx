"use client";

import { createBrowserAuthClient } from "@certibuy/integrations/supabase";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import AuthForm, { Field } from "@/components/auth/AuthForm";
import { safeReturnTo } from "@/lib/paths";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("link") === "expired"
      ? "That link has expired. Sign in or request a new one."
      : null,
  );

  async function onSubmit(form: FormData) {
    setBusy(true);
    setError(null);
    const { error: authError } = await createBrowserAuthClient().auth.signInWithPassword({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    });
    if (authError) {
      setBusy(false);
      setError("Email or password is incorrect. Try again or reset your password.");
      return;
    }
    router.replace(safeReturnTo(params.get("returnTo")));
    router.refresh();
  }

  return (
    <AuthForm
      title="Sign in"
      onSubmit={onSubmit}
      submitLabel="Sign in"
      busy={busy}
      error={error}
      footer={
        <>
          <Link href="/forgot-password">Forgot your password?</Link> ·{" "}
          <Link href="/register">Create an account</Link>
        </>
      }
    >
      <Field label="Email" name="email" type="email" autoComplete="email" inputMode="email" />
      <Field label="Password" name="password" type="password" autoComplete="current-password" />
    </AuthForm>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
