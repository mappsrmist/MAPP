"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { batchFormSchema } from "@/lib/validators";
import { createClient } from "@/lib/supabase/client";
import type { BatchRow, RequestDetail } from "@/lib/types";

type In = z.input<typeof batchFormSchema>;
type Out = z.output<typeof batchFormSchema>;

export function BatchFormDialog({
  batchNo,
  existing,
  options,
  facultyName,
  onClose,
  onSaved,
}: {
  batchNo: number;
  existing: BatchRow | null;
  options: RequestDetail[];
  facultyName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const members = existing ? [...existing.batch_members].sort((a, b) => a.slot - b.slot) : [];
  const [confirmClear, setConfirmClear] = React.useState(false);

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<In, unknown, Out>({
    resolver: zodResolver(batchFormSchema),
    defaultValues: {
      student1: members[0]?.student_id ?? "",
      student2: members[1]?.student_id ?? "",
      section: existing?.section ?? "",
      advisor: existing?.advisor_name ?? facultyName,
      contact: existing?.contact_number ?? "",
      mail: existing?.srm_mail ?? "",
    },
  });

  const s1 = useWatch({ control, name: "student1" }) ?? "";
  const s2 = useWatch({ control, name: "student2" }) ?? "";
  const byId = new Map(options.map((o) => [o.student_id, o]));

  async function onSubmit(v: Out) {
    const { error } = await supabase.rpc("save_batch", {
      p_batch_no: batchNo,
      p_student1: v.student1,
      p_student2: v.student2,
      p_section: v.section,
      p_advisor: v.advisor,
      p_contact: v.contact,
      p_mail: v.mail,
    });
    if (error) return void toast.error(error.message);
    toast.success(`Batch ${batchNo} saved`);
    onSaved();
  }

  async function clear() {
    const { error } = await supabase.rpc("clear_batch", { p_batch_no: batchNo });
    if (error) return void toast.error(error.message);
    toast.success(`Batch ${batchNo} cleared`);
    onSaved();
  }

  const studentSelect = (name: "student1" | "student2", label: string, other: string) => {
    const picked = byId.get(name === "student1" ? s1 : s2);
    return (
      <div className="rounded-lg border p-3">
        <Field label={label} htmlFor={name} error={errors[name]?.message}>
          <Select id={name} {...register(name)}>
            <option value="">Select a student…</option>
            {options
              .filter((o) => o.student_id !== other)
              .map((o) => (
                <option key={o.student_id} value={o.student_id}>
                  {o.student_name} ({o.reg_no})
                </option>
              ))}
          </Select>
        </Field>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Input aria-label={`${label} name`} readOnly tabIndex={-1} value={picked?.student_name ?? ""} placeholder="Name" className="bg-muted" />
          <Input aria-label={`${label} registration number`} readOnly tabIndex={-1} value={picked?.reg_no ?? ""} placeholder="Registration No." className="bg-muted" />
        </div>
      </div>
    );
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent title={`Batch ${batchNo}`} description="Choose two students you have accepted, then fill in the batch details." className="max-w-xl">
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {options.length < 2 && (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
                You need at least two accepted students who are not already in a batch.
              </p>
            )}
            {studentSelect("student1", "Student 1", s2)}
            {studentSelect("student2", "Student 2", s1)}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Section" htmlFor="section" error={errors.section?.message}>
                <Input id="section" {...register("section")} />
              </Field>
              <Field label="Faculty Advisor Name" htmlFor="advisor" error={errors.advisor?.message}>
                <Input id="advisor" {...register("advisor")} />
              </Field>
              <Field label="Contact Number" htmlFor="contact" error={errors.contact?.message}>
                <Input id="contact" inputMode="tel" {...register("contact")} />
              </Field>
              <Field label="SRM Mail ID" htmlFor="mail" error={errors.mail?.message}>
                <Input id="mail" type="email" {...register("mail")} />
              </Field>
            </div>
            <DialogFooter>
              {existing && (
                <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirmClear(true)}>
                  Clear batch
                </Button>
              )}
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                Group
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={`Clear Batch ${batchNo}?`}
        description="Both students become unassigned. You can group them again later."
        confirmLabel="Clear batch"
        destructive
        onConfirm={clear}
      />
    </>
  );
}
