"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Info } from "lucide-react";
import { toast } from "sonner";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui/card";
import { ConfirmDialog, MessageDialog } from "@/components/ui/dialog";
import { useGlobalFreeze } from "@/components/freeze";
import { MOOC_IMPORTANT, MOOC_RULES, MOOC_TITLE, MSG } from "@/lib/config";
import { createClient } from "@/lib/supabase/client";
import { useRealtime } from "@/lib/hooks";
import type { MoocRequest, StudentChoice } from "@/lib/types";

export function MoocClient({ choice, request }: { choice: StudentChoice; request: MoocRequest | null }) {
  const router = useRouter();
  const frozen = useGlobalFreeze();
  const [cgpa, setCgpa] = React.useState("");
  const eligible = cgpa.trim() !== "" && Number.isFinite(Number(cgpa)) && Number(cgpa) >= 9 && Number(cgpa) <= 10;
  const [agree, setAgree] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [success, setSuccess] = React.useState(false);

  async function optIn() {
    if (!eligible || !agree || frozen) return;
    const { error } = await createClient().rpc("opt_mooc", { p_cgpa: Number(cgpa) });
    if (error) {
      toast.error(error.message);
      router.refresh();
      return;
    }
    setSuccess(true);
  }

  useRealtime([{ table: "mooc_requests" }, { table: "students" }], () => router.refresh());
  React.useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 20000);
    return () => clearInterval(timer);
  }, [router]);
  const opted = choice === "mooc";
  const pending = choice === "mooc_pending";
  const needsCgpa = pending && request?.cgpa == null;

  return (
    <>
      <PageHeader title="MOOC" description="Opt for the MOOC course instead of a Minor project." />

      {opted && (
        <Card className="mb-6 border-success/40 bg-success/10">
          <CardContent className="flex items-center gap-3 p-5">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-success" aria-hidden />
            <div>
              <p className="font-semibold">Your MOOC request is approved</p>
              <p className="text-sm text-muted-foreground">Your Faculty Advisor has approved your request. You can proceed with MOOC course selection. The Minor Project dashboard is unavailable.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {pending && <Card className="mb-6 border-warning/40 bg-warning/10"><CardContent className="flex items-start gap-3 p-5"><Clock className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden /><div><p className="font-semibold">Awaiting Faculty Advisor approval</p><p className="text-sm text-muted-foreground">Your CGPA: {request?.cgpa == null ? "Not provided" : Number(request.cgpa).toFixed(2)}. MOOC access is granted only after your advisor approves your request. Minor is unavailable while this request is pending.</p>{needsCgpa && <p className="mt-2 text-sm">Supply your CGPA below so your advisor can review your request.</p>}</div></CardContent></Card>}
      {!pending && choice === null && request?.status === "declined" && <p className="mb-6 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">Your Faculty Advisor declined your previous MOOC request. You may submit a new request with your current CGPA or choose Minor.</p>}
      {choice === null && request?.status === "cancelled" && <p className="mb-6 rounded-lg border bg-muted p-4 text-sm">Your previous MOOC request was cancelled when your choice was reset. You can submit a new request or choose Minor.</p>}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{MOOC_TITLE}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {MOOC_RULES.map((r, i) => (
              <li key={r.title} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{i + 1}</span>
                <p className="text-sm leading-relaxed">
                  <span className="font-semibold">{r.title}:</span> {r.text}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-5 flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
            <Info className="h-5 w-5 shrink-0 text-warning" aria-hidden />
            <p>
              <span className="font-semibold">Important:</span> {MOOC_IMPORTANT}
            </p>
          </div>

          {choice === "minor" && (
            <p className="mt-6 rounded-lg border bg-accent/50 p-4 text-sm">
              You have an active Minor project request, so you cannot opt for MOOC unless it is declined.
            </p>
          )}

          {(choice === null || needsCgpa) && (
            <div className="mt-6 space-y-4 border-t pt-5">
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--primary)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>{MSG.MOOC_AGREE}</span>
              </label>
              <Button disabled={!agree || frozen} title={frozen ? MSG.FROZEN_TIP : undefined} onClick={() => setConfirm(true)}>
                Submit
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Request MOOC approval"
        description="Your Faculty Advisor will review your CGPA. Minor will be unavailable while the request is pending or approved. MOOC access starts only after approval."
        confirmLabel="Send to Faculty Advisor"
        onConfirm={optIn}
        confirmDisabled={!eligible || !agree || frozen}
      >
        <Field label="Your CGPA" htmlFor="mooc-cgpa">
          <Input id="mooc-cgpa" type="number" min="9.00" max="10" step="0.01" value={cgpa} onChange={(e) => setCgpa(e.target.value)} />
          <p className="mt-2 text-sm text-muted-foreground">Enter your current CGPA. It must be 9.00 or above and no higher than 10.00.</p>
        </Field>
      </ConfirmDialog>
      <MessageDialog
        open={success}
        onOpenChange={setSuccess}
        title="MOOC request sent"
        message={MSG.MOOC_SUCCESS}
        onClose={() => router.refresh()}
      />
    </>
  );
}
