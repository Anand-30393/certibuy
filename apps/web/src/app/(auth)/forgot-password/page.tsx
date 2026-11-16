"use client";

import { createBrowserAuthClient } from "@certibuy/integrations/supabase";
import Link from "next/link";
import { useState } from "react";
import AuthForm, { Field } from "@/components/auth/AuthForm";

export default function ForgotPasswordPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(form: FormData) {
    setBusy(true);
    setError(null);
    const { error: authError } = await createBrowserAuthClient().auth.resetPasswordForEmail(
      String(form.get("email") ?? "").trim(),
      { redirectTo: `${window.location.origin}/auth/callback?next=/reset-password` },
    );
    setBusy(false);
    if (authError) return setError("We couldn't send the email. Wait a minute and try again.");
    setNotice("If that email has an account, a reset link is on its way.");
  }

  return (
    <AuthForm
      title="Reset your password"
      onSubmit={onSubmit}
      submitLabel="Send reset link"
      busy={busy}
      error={error}
      notice={notice}
      footer={<Link href="/login">Back to sign in</Link>}
    >
      <Field label="Email" name="email" type="email" autoComplete="email" inputMode="email" />
    </AuthForm>
  );
}
