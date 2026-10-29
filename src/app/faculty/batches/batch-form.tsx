"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { MSG } from "@/lib/config";
import { batchFormSchema } from "@/lib/validators";
import { createClient } from "@/lib/supabase/client";
import type { BatchRow, FacultyRow, RequestDetail } from "@/lib/types";

type In = z.input<typeof batchFormSchema>;
type Out = z.output<typeof batchFormSchema>;
type Slot = "m1" | "m2";

/**
 * Group (or edit) one batch. Each of the two students has their own Section, Faculty Advisor Name, Contact Number
 * and SRM Mail ID. The advisor name is filled from the section -> Faculty Advisor mapping (blank when the section has
 * no advisor yet); mail is prefilled from the student's SRM mail; contact is prefilled from the faculty's profile.
 * Everything stays editable.
 */
export function BatchFormDialog({
  batchNo,
  existing,
  options,
  faculty,
  frozen,
  onClose,
  onSaved,
}: {
  batchNo: number;
  existing: BatchRow | null;
  options: RequestDetail[];
  faculty: FacultyRow;
  frozen: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const members = existing ? [...existing.batch_members].sort((a, b) => a.slot - b.slot) : [];
  const byId = new Map(options.map((o) => [o.student_id, o]));
  // the last advisor name and mail we filled in per slot, so a manual override is never overwritten
  const autoAdvisor = React.useRef<Record<Slot, string>>({ m1: "", m2: "" });
  const autoMail = React.useRef<Record<Slot, string>>({ m1: "", m2: "" });

  const blank = (i: number) => {
    const sid = members[i]?.student_id ?? "";
    const st = sid ? byId.get(sid) : undefined;
    const advisor = members[i]?.advisor_name || st?.fa_name || "";
    const mail = members[i]?.srm_mail || st?.student_email || "";
    const slotKey: Slot = i === 0 ? "m1" : "m2";
    autoAdvisor.current[slotKey] = advisor;
    autoMail.current[slotKey] = mail;
    return {
      student: sid,
      section: members[i]?.section || st?.student_section || "",
      advisor,
      contact: members[i]?.contact_number || faculty.phone || "",
      mail,
    };
  };

  const {
    control,
    register,
    setValue,
    getValues,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<In, unknown, Out>({
    resolver: zodResolver(batchFormSchema),
    defaultValues: { m1: blank(0), m2: blank(1) },
  });

  const s1 = useWatch({ control, name: "m1.student" }) ?? "";
  const s2 = useWatch({ control, name: "m2.student" }) ?? "";

  async function onSubmit(v: Out) {
    const { error } = await supabase.rpc("save_batch", {
      p_batch_no: batchNo,
      p_members: [v.m1, v.m2].map((m) => ({
        student_id: m.student,
        section: m.section,
        advisor_name: m.advisor,
        contact_number: m.contact,
        srm_mail: m.mail,
      })),
    });
    if (error) return void toast.error(error.message);
    toast.success(existing ? `Batch ${batchNo} updated` : `Batch ${batchNo} grouped`);
    onSaved();
  }

  const block = (slot: Slot, label: string, other: string) => {
    const e = errors[slot];
    const picked = byId.get(slot === "m1" ? s1 : s2);
    const pick = register(`${slot}.student`);
    return (
      <fieldset className="rounded-lg border p-3" disabled={frozen}>
        <legend className="px-1 text-sm font-semibold">{label}</legend>
        <Field label="Student" htmlFor={`${slot}-student`} error={e?.student?.message}>
          <Select
            id={`${slot}-student`}
            {...pick}
            onChange={(ev) => {
              void pick.onChange(ev);
              const sid = ev.target.value;
              const st = byId.get(sid);
              if (st?.student_section && !getValues(`${slot}.section`)) {
                setValue(`${slot}.section`, st.student_section);
              }
              const currentAdvisor = getValues(`${slot}.advisor`);
              if (!currentAdvisor || currentAdvisor === autoAdvisor.current[slot]) {
                const nextAdvisor = st?.fa_name ?? "";
                autoAdvisor.current[slot] = nextAdvisor;
                setValue(`${slot}.advisor`, nextAdvisor);
              }
              const currentMail = getValues(`${slot}.mail`);
              if (!currentMail || currentMail === autoMail.current[slot] || currentMail === faculty.srm_email) {
                const nextMail = st?.student_email ?? "";
                autoMail.current[slot] = nextMail;
                setValue(`${slot}.mail`, nextMail);
              }
            }}
          >
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
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Section" htmlFor={`${slot}-section`} error={e?.section?.message}>
            <Input id={`${slot}-section`} maxLength={20} {...register(`${slot}.section`)} />
          </Field>
          <Field label="Faculty Advisor Name" htmlFor={`${slot}-advisor`} error={e?.advisor?.message}>
            <Input id={`${slot}-advisor`} maxLength={100} {...register(`${slot}.advisor`)} />
          </Field>
          <Field label="Contact Number" htmlFor={`${slot}-contact`} error={e?.contact?.message}>
            <Input id={`${slot}-contact`} inputMode="tel" {...register(`${slot}.contact`)} />
          </Field>
          <Field label="SRM Mail ID" htmlFor={`${slot}-mail`} error={e?.mail?.message}>
            <Input id={`${slot}-mail`} type="email" {...register(`${slot}.mail`)} />
          </Field>
        </div>
      </fieldset>
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`${existing ? "Edit" : "Group"} Batch ${batchNo}`}
        description="Choose two students you have accepted. Each student has their own section, advisor, contact and mail."
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
      >
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          {frozen && <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">{MSG.FROZEN_HINT}</p>}
          {options.length < 2 && (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
              You need at least two accepted students who are not already in a batch.
            </p>
          )}
          {block("m1", "Student 1", s2)}
          {block("m2", "Student 2", s1)}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting} disabled={frozen} title={frozen ? MSG.FROZEN_TIP : undefined}>
              {existing ? "Save changes" : "Group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
