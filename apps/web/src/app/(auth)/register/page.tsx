"use client";

import { createBrowserAuthClient } from "@certibuy/integrations/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AuthForm, { Field } from "@/components/auth/AuthForm";

export default function RegisterPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(form: FormData) {
    const fullName = String(form.get("full_name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (fullName.length < 2) return setError("Enter your full name.");
    if (password.length < 8) return setError("Use a password of at least 8 characters.");

    setBusy(true);
    setError(null);
    const { data, error: authError } = await createBrowserAuthClient().auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setBusy(false);
    if (authError) return setError(authError.message);
    if (data.session) {
      router.replace("/");
      router.refresh();
      return;
    }
    setNotice("Check your email to confirm your account, then sign in.");
  }

  return (
    <AuthForm
      title="Create your account"
      onSubmit={onSubmit}
      submitLabel="Create account"
      busy={busy}
      error={error}
      notice={notice}
      footer={
        <>
          Already have an account? <Link href="/login">Sign in</Link>
        </>
      }
    >
      <Field label="Full name" name="full_name" autoComplete="name" />
      <Field label="Email" name="email" type="email" autoComplete="email" inputMode="email" />
      <Field label="Password" name="password" type="password" autoComplete="new-password" />
    </AuthForm>
  );
}
