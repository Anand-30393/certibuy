"use client";

import { createBrowserAuthClient } from "@certibuy/integrations/supabase";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AuthForm, { Field } from "@/components/auth/AuthForm";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(form: FormData) {
    const password = String(form.get("password") ?? "");
    if (password.length < 8) return setError("Use a password of at least 8 characters.");
    setBusy(true);
    setError(null);
    const { error: authError } = await createBrowserAuthClient().auth.updateUser({ password });
    setBusy(false);
    if (authError) {
      return setError("That reset link has expired. Request a new one from the sign-in page.");
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <AuthForm
      title="Choose a new password"
      onSubmit={onSubmit}
      submitLabel="Save password"
      busy={busy}
      error={error}
    >
      <Field label="New password" name="password" type="password" autoComplete="new-password" />
    </AuthForm>
  );
}
