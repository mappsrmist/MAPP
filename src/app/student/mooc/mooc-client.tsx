"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui/card";
import { ConfirmDialog, MessageDialog } from "@/components/ui/dialog";
import { useGlobalFreeze } from "@/components/freeze";
import { MOOC_IMPORTANT, MOOC_RULES, MOOC_TITLE, MSG } from "@/lib/config";
import { createClient } from "@/lib/supabase/client";

export function MoocClient({ choice }: { choice: "mooc" | "minor" | null }) {
  const router = useRouter();
  const frozen = useGlobalFreeze();
  const [agree, setAgree] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [success, setSuccess] = React.useState(false);

  async function optIn() {
    const { error } = await createClient().rpc("opt_mooc");
    if (error) {
      toast.error(error.message);
      router.refresh();
      return;
    }
    setSuccess(true);
  }

  const opted = choice === "mooc";

  return (
    <>
      <PageHeader title="MOOC" description="Opt for the MOOC course instead of a Minor project." />

      {opted && (
        <Card className="mb-6 border-success/40 bg-success/10">
          <CardContent className="flex items-center gap-3 p-5">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-success" aria-hidden />
            <div>
              <p className="font-semibold">You have opted for MOOC</p>
              <p className="text-sm text-muted-foreground">Your choice is recorded. The Minor Project dashboard is unavailable. Contact the admin if this needs to change.</p>
            </div>
          </CardContent>
        </Card>
      )}

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

          {choice === null && (
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
        title="Confirm MOOC selection"
        description="You will not be able to apply for a Minor project after this. Do you want to continue?"
        confirmLabel="Yes, opt for MOOC"
        onConfirm={optIn}
      />
      <MessageDialog
        open={success}
        onOpenChange={setSuccess}
        title="MOOC selected"
        message={MSG.MOOC_SUCCESS}
        onClose={() => router.refresh()}
      />
    </>
  );
}
