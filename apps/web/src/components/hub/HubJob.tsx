"use client";

// Counter steps as a stack of cards; each is enabled only when the server says it is next
// (frontend.md §6 "Hub job").
import {
  REJECT_REASONS,
  TECH_CHECKLIST,
  type HubJobViewT,
  type RejectReasonCode,
} from "@certibuy/contracts";
import { formatInr } from "@certibuy/domain";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { GradeChip, StatusChip } from "@/components/common/ui";
import { command } from "@/lib/api";
import SignaturePad from "./SignaturePad";

function useCommand() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(name: string, body: unknown): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      const r = await command<T>(name, body);
      router.refresh();
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}

function Card(props: { title: string; active: boolean; done?: boolean; children: ReactNode }) {
  return (
    <section
      className={`surface panel stack step-card${props.active ? " active" : ""}`}
      aria-disabled={!props.active}
    >
      <h2>
        {props.done ? "✓ " : ""}
        {props.title}
      </h2>
      {props.active ? props.children : null}
    </section>
  );
}

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}

function RejectPanel({ job, codes }: { job: HubJobViewT; codes: RejectReasonCode[] }) {
  const { run, busy, error } = useCommand();
  const [code, setCode] = useState<RejectReasonCode>(codes[0] ?? "unsafe_device");
  const [note, setNote] = useState("");
  return (
    <details className="reject-panel">
      <summary>Reject the device</summary>
      <div className="stack">
        <div className="chip-row">
          {codes.map((c) => (
            <button
              key={c}
              type="button"
              className="pill"
              aria-pressed={code === c}
              onClick={() => setCode(c)}
            >
              {REJECT_REASONS[c].split(",")[0]}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field-label">Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </label>
        <ErrorText error={error} />
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Reject this device and return it to the seller?")) {
              void run("rejectDevice", {
                submissionId: job.submissionId,
                reasonCode: code,
                ...(note ? { note } : {}),
              });
            }
          }}
        >
          Confirm reject
        </button>
      </div>
    </details>
  );
}

function IdentityStep({ job }: { job: HubJobViewT }) {
  const { run, busy, error } = useCommand();
  const [imei, setImei] = useState("");
  const [lockOff, setLockOff] = useState<boolean | null>(null);
  const failed = job.inspection?.identityPassed === false;
  return (
    <div className="stack">
      {failed && (
        <p className="form-error" role="alert">
          Identity check failed:{" "}
          {job.inspection?.imeiMatch === false
            ? "the IMEI doesn't match."
            : job.inspection?.blacklistClear === false
              ? "the IMEI is blacklisted."
              : "activation lock is on."}{" "}
          Re-check, or reject the device below.
        </p>
      )}
      <label className="field">
        <span className="field-label">Scanned IMEI</span>
        <input
          inputMode="numeric"
          maxLength={15}
          value={imei}
          onChange={(e) => setImei(e.target.value.replace(/\D/g, ""))}
        />
      </label>
      <fieldset className="field">
        <legend className="field-label">Activation lock</legend>
        <div className="chip-row">
          <button
            type="button"
            className="pill"
            aria-pressed={lockOff === true}
            onClick={() => setLockOff(true)}
          >
            Off
          </button>
          <button
            type="button"
            className="pill"
            aria-pressed={lockOff === false}
            onClick={() => setLockOff(false)}
          >
            Still on
          </button>
        </div>
      </fieldset>
      <ErrorText error={error} />
      <button
        type="button"
        className="button primary"
        disabled={busy || imei.length !== 15 || lockOff === null}
        onClick={() =>
          run("verifyIdentity", {
            submissionId: job.submissionId,
            scannedImei: imei,
            activationLockOff: lockOff,
          })
        }
      >
        Check identity
      </button>
      <RejectPanel
        job={job}
        codes={[
          "imei_mismatch",
          "blacklisted",
          "activation_lock_on",
          "identity_failed",
          "unsafe_device",
        ]}
      />
    </div>
  );
}

function ChecklistStep({ job }: { job: HubJobViewT }) {
  const { run, busy, error } = useCommand();
  const [checks, setChecks] = useState<Record<string, "pass" | "fail">>({});
  const [battery, setBattery] = useState("");
  const [cosmetic, setCosmetic] = useState<"A" | "B" | "C" | "D" | null>(null);
  const ready =
    TECH_CHECKLIST.every((c) => checks[c.key]) &&
    Number(battery) >= 50 &&
    Number(battery) <= 100 &&
    cosmetic;
  return (
    <div className="stack">
      <ul className="list">
        {TECH_CHECKLIST.map((c) => (
          <li key={c.key} className="list-row">
            <span>{c.label}</span>
            <div className="chip-row" role="group" aria-label={c.label}>
              {(["pass", "fail"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className="pill"
                  aria-pressed={checks[c.key] === v}
                  onClick={() => setChecks((s) => ({ ...s, [c.key]: v }))}
                >
                  {v === "pass" ? "Pass" : "Fail"}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <label className="field">
        <span className="field-label">Battery health (%)</span>
        <input
          inputMode="numeric"
          maxLength={3}
          value={battery}
          onChange={(e) => setBattery(e.target.value.replace(/\D/g, ""))}
        />
      </label>
      <fieldset className="field">
        <legend className="field-label">Cosmetic grade</legend>
        <div className="chip-row">
          {(["A", "B", "C", "D"] as const).map((g) => (
            <button
              key={g}
              type="button"
              className="pill"
              aria-pressed={cosmetic === g}
              onClick={() => setCosmetic(g)}
            >
              {g}
            </button>
          ))}
        </div>
      </fieldset>
      <ErrorText error={error} />
      <button
        type="button"
        className="button primary"
        disabled={busy || !ready}
        onClick={() =>
          run("confirmGrade", {
            submissionId: job.submissionId,
            checklist: checks,
            batteryHealth: Number(battery),
            cosmeticGrade: cosmetic,
          })
        }
      >
        Confirm grade and seal the report
      </button>
      <RejectPanel job={job} codes={["unsafe_device"]} />
    </div>
  );
}

function DecisionStep({ job }: { job: HubJobViewT }) {
  const { run, busy, error } = useCommand();
  const [feePaid, setFeePaid] = useState(true);
  const i = job.inspection;
  if (!i?.verdict) return null;
  return (
    <div className="stack">
      <p className="row">
        Confirmed grade {i.finalGrade && <GradeChip grade={i.finalGrade} />}{" "}
        <StatusChip group="verdict" value={i.verdict} />
      </p>
      {i.verdict === "one_below" && (
        <>
          <p>
            Quoted {i.quoted !== null ? formatInr(i.quoted) : "—"} → revised{" "}
            <strong>{i.revised !== null ? formatInr(i.revised) : "—"}</strong>. Ask the seller to
            decide.
          </p>
          <div className="row">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => run("acceptRevised", { submissionId: job.submissionId })}
            >
              Seller accepts
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => run("declineRevised", { submissionId: job.submissionId })}
            >
              Seller declines (return device)
            </button>
          </div>
        </>
      )}
      {i.verdict === "two_below" && (
        <>
          <p>
            Two or more grades below the quote. Return the device and collect the mismatch fee of{" "}
            {formatInr(job.mismatchFee)}.
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={feePaid}
              onChange={(e) => setFeePaid(e.target.checked)}
            />
            <span>Mismatch fee collected at the counter</span>
          </label>
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => run("rejectForMismatch", { submissionId: job.submissionId, feePaid })}
          >
            Return device and record the mismatch
          </button>
        </>
      )}
      <ErrorText error={error} />
    </div>
  );
}

function HandoverStep({ job }: { job: HubJobViewT }) {
  const { run, busy, error } = useCommand();
  const [sealed, setSealed] = useState(false);
  const [tag, setTag] = useState("CB-");
  const [signature, setSignature] = useState<Blob | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handover() {
    setUploadError(null);
    if (!signature) return setUploadError("Ask the seller to sign first.");
    try {
      const up = await command<{ signedUrl: string; path: string }>("requestSignatureUpload", {
        submissionId: job.submissionId,
      });
      const res = await fetch(up.signedUrl, {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: signature,
      });
      if (!res.ok) throw new Error("The signature didn't upload. Try again.");
      await run("completeHandover", {
        submissionId: job.submissionId,
        sealed: true,
        tagId: tag.trim().toUpperCase(),
        signaturePath: up.path,
      });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "The signature didn't upload. Try again.");
    }
  }

  return (
    <div className="stack">
      <p>
        Agreed price:{" "}
        <strong>{job.agreedAmount !== null ? formatInr(job.agreedAmount) : "—"}</strong>
        {job.option === "sell_for_more"
          ? " (50% is paid now, the balance when it sells or on day 21)."
          : " (paid in full now)."}
      </p>
      <label className="check-row">
        <input type="checkbox" checked={sealed} onChange={(e) => setSealed(e.target.checked)} />
        <span>Device sealed in a tamper-evident bag</span>
      </label>
      <label className="field">
        <span className="field-label">Custody tag</span>
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          maxLength={8}
          placeholder="CB-12345"
        />
      </label>
      <div className="field">
        <span className="field-label">Seller signature</span>
        <SignaturePad onChange={setSignature} />
      </div>
      <ErrorText error={uploadError ?? error} />
      <button
        type="button"
        className="button primary"
        disabled={busy || !sealed || !/^CB-\d{5}$/i.test(tag.trim()) || !signature}
        onClick={handover}
      >
        Complete handover and pay
      </button>
      <RejectPanel job={job} codes={["unsafe_device", "identity_failed"]} />
    </div>
  );
}

export default function HubJob({ job }: { job: HubJobViewT }) {
  const step = job.nextStep;
  if (step === "closed") {
    return (
      <div className="surface panel">
        <p className="field-label">Visit closed</p>
        <p>
          {job.rejectReason ?? "The seller declined the revised price and took the device back."}
        </p>
      </div>
    );
  }
  if (step === "done" && job.handover) {
    const h = job.handover;
    return (
      <div className="surface panel stack">
        <h2>✓ Handed over</h2>
        <p>
          Tag <code>{h.tagId}</code> · paid {formatInr(h.paid)}{" "}
          <StatusChip group="payout_status" value={h.payoutStatus} />
        </p>
        <p>
          {h.listingPrice !== null
            ? `Listed at ${formatInr(h.listingPrice)} with ${h.warrantyMonths}-month warranty.`
            : "Grade D: sent to refurbishment before listing."}
        </p>
        <p className="meta">Payouts are simulated in this demo — no real money moves.</p>
      </div>
    );
  }
  const order = ["identity", "checklist", "decision", "handover"] as const;
  const at = order.indexOf(step as (typeof order)[number]);
  const isDone = (s: (typeof order)[number]) => order.indexOf(s) < at;
  return (
    <div className="stack">
      <Card title="1. Identity and IMEI" active={step === "identity"} done={isDone("identity")}>
        <IdentityStep job={job} />
      </Card>
      <Card
        title="2. Inspection checklist"
        active={step === "checklist"}
        done={isDone("checklist")}
      >
        <ChecklistStep job={job} />
      </Card>
      <Card title="3. Decision" active={step === "decision"} done={isDone("decision")}>
        <DecisionStep job={job} />
      </Card>
      <Card title="4. Handover" active={step === "handover"}>
        <HandoverStep job={job} />
      </Card>
    </div>
  );
}
