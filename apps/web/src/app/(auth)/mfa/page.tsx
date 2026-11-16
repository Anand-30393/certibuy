"use client";

// Two-step verification (TOTP). Staff must complete it before using hub or ops tools
// (REQUIRE_STAFF_MFA). First visit enrols an authenticator app; later visits verify a code.
import { createBrowserAuthClient } from "@certibuy/integrations/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import AuthForm, { Field } from "@/components/auth/AuthForm";
import { safeReturnTo } from "@/lib/paths";

type Setup = { factorId: string; qr: string | null; secret: string | null };

function MfaForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserAuthClient();
    (async () => {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) return setError("Sign in again to set up two-step verification.");
      const totp = data.all.filter((f) => f.factor_type === "totp");
      const verified = totp.find((f) => f.status === "verified");
      if (verified) return setSetup({ factorId: verified.id, qr: null, secret: null });
      // Clear abandoned enrolments, then start a fresh one.
      for (const f of totp) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data: enrolled, error: enrolError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `CertiBuy ${Date.now()}`,
      });
      if (enrolError) return setError("We couldn't start set-up. Refresh the page to try again.");
      setSetup({ factorId: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret });
    })();
  }, []);

  async function onSubmit(form: FormData) {
    if (!setup) return;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await createBrowserAuthClient().auth.mfa.challengeAndVerify({
      factorId: setup.factorId,
      code: String(form.get("code") ?? "").replace(/\s/g, ""),
    });
    setBusy(false);
    if (verifyError)
      return setError("That code didn't match. Check the time on your phone and try again.");
    router.replace(safeReturnTo(params.get("returnTo")));
    router.refresh();
  }

  return (
    <AuthForm
      title="Two-step verification"
      onSubmit={onSubmit}
      submitLabel="Verify"
      busy={busy || !setup}
      error={error}
    >
      {setup?.qr ? (
        <>
          <p>Scan this code with an authenticator app, then enter the 6-digit code it shows.</p>
          <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} />
          <p className="meta">
            Can&apos;t scan? Enter this key: <code>{setup.secret}</code>
          </p>
        </>
      ) : (
        <p>Enter the 6-digit code from your authenticator app.</p>
      )}
      <Field label="Code" name="code" inputMode="numeric" autoComplete="one-time-code" />
    </AuthForm>
  );
}

export default function MfaPage() {
  return (
    <Suspense>
      <MfaForm />
    </Suspense>
  );
}
