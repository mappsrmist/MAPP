"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Download, Lock, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, MessageDialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { useGlobalFreeze } from "@/components/freeze";
import { MSG, SDG_GOALS } from "@/lib/config";
import { applicationSubmitSchema } from "@/lib/validators";
import { createClient } from "@/lib/supabase/client";
import { useRealtime } from "@/lib/hooks";
import type { ApplicationForm } from "@/lib/types";

interface Values {
  title: string;
  sdg: string;
  problem: "" | "yes" | "no";
  s1_mail: string;
  s1_mobile: string;
  s2_name: string;
  s2_reg: string;
  s2_section: string;
  s2_mail: string;
  s2_mobile: string;
}

const EMPTY: Values = { title: "", sdg: "", problem: "", s1_mail: "", s1_mobile: "", s2_name: "", s2_reg: "", s2_section: "", s2_mail: "", s2_mobile: "" };

const toValues = (f: ApplicationForm): Values => ({
  title: f.project_title ?? "",
  sdg: f.sdg_goal ?? "",
  problem: f.problem_by_guide === null ? "" : f.problem_by_guide ? "yes" : "no",
  s1_mail: f.s1_mail ?? "",
  s1_mobile: f.s1_mobile ?? "",
  s2_name: f.s2_name ?? "",
  s2_reg: f.s2_reg ?? "",
  s2_section: f.s2_section ?? "",
  s2_mail: f.s2_mail ?? "",
  s2_mobile: f.s2_mobile ?? "",
});

/** The form as the PDF / RPC see it: the typed values laid over the server's read-only data. */
const merge = (f: ApplicationForm, v: Values): ApplicationForm => ({
  ...f,
  project_title: v.title,
  sdg_goal: v.sdg,
  problem_by_guide: v.problem === "" ? null : v.problem === "yes",
  s1_mail: v.s1_mail,
  s1_mobile: v.s1_mobile,
  s2_name: v.s2_name,
  s2_reg: v.s2_reg,
  s2_section: v.s2_section,
  s2_mail: v.s2_mail,
  s2_mobile: v.s2_mobile,
});

export function ApplicationClient() {
  const supabase = React.useMemo(() => createClient(), []);
  const router = useRouter();
  const frozen = useGlobalFreeze();
  const [form, setForm] = React.useState<ApplicationForm | null>(null);
  const [locked, setLocked] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);

  const {
    register,
    getValues,
    reset,
    setError,
    clearErrors,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<Values>({ defaultValues: EMPTY });

  const load = React.useCallback(async () => {
    const { data, error } = await supabase.rpc("get_application");
    const row = (data as ApplicationForm[] | null)?.[0];
    if (error || !row) {
      setLocked(true);
      return;
    }
    setLocked(false);
    setForm(row);
    reset(toValues(row));
  }, [supabase, reset]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // a team mate's save (or an admin change) arrives live; never overwrite what this student is typing
  useRealtime([{ table: "applications" }, { table: "requests" }], () => {
    if (!isDirty) void load();
  });

  if (locked) {
    return (
      <>
        <PageHeader title="Application Form" />
        <Card>
          <EmptyState title="Application Form unavailable" hint={MSG.APPLICATION_LOCKED} icon={<Lock className="h-8 w-8" aria-hidden />} />
        </Card>
        <MessageDialog open onOpenChange={() => undefined} title="Application Form" message={MSG.APPLICATION_LOCKED} onClose={() => router.replace("/student/minor")} />
      </>
    );
  }

  if (!form) {
    return (
      <>
        <PageHeader title="Application Form" />
        <Skeleton className="h-96 w-full" />
      </>
    );
  }

  const editable = form.can_edit && !frozen;
  const submitted = form.status === "submitted";

  async function save(submit: boolean) {
    const v = getValues();
    const { error } = await supabase.rpc("save_application", {
      p_title: v.title,
      p_sdg: v.sdg,
      p_problem: v.problem === "" ? null : v.problem === "yes",
      p_s1_mail: v.s1_mail,
      p_s1_mobile: v.s1_mobile,
      p_s2_name: v.s2_name,
      p_s2_reg: v.s2_reg,
      p_s2_section: v.s2_section,
      p_s2_mail: v.s2_mail,
      p_s2_mobile: v.s2_mobile,
      p_submit: submit,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(submit ? "Application submitted" : "Draft saved");
    await load();
  }

  function askSubmit() {
    clearErrors();
    const parsed = applicationSubmitSchema.safeParse(getValues());
    if (!parsed.success) {
      parsed.error.issues.forEach((i) => setError(i.path[0] as keyof Values, { message: i.message }));
      toast.error("Please fix the highlighted fields.");
      return;
    }
    setConfirm(true);
  }

  async function download() {
    const { downloadApplicationPdf } = await import("@/lib/application-pdf");
    await downloadApplicationPdf(merge(form!, getValues()));
  }

  const dis = !editable;
  const ro = "bg-muted";
  const s2 = (locked2: boolean) => ({ readOnly: locked2, disabled: !locked2 && dis, className: locked2 ? ro : undefined });

  return (
    <>
      <PageHeader
        title="Application Form"
        description="Fill in your team's Minor project details. Both team members see and can edit the same form until it is submitted."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={submitted ? "success" : "warning"}>{submitted ? "Submitted" : "Draft"}</Badge>
            <Button variant="outline" onClick={() => void download()}>
              <Download className="h-4 w-4" /> Download PDF
            </Button>
          </div>
        }
      />
      {!editable && (
        <p className="mb-4 rounded-lg border bg-accent/50 p-3 text-sm">
          {submitted ? "This application has been submitted and can no longer be edited. You can still download it." : MSG.FROZEN_HINT}
        </p>
      )}

      <form onSubmit={(e) => e.preventDefault()} noValidate className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Project details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Project Title" htmlFor="title" error={errors.title?.message}>
                <Input id="title" maxLength={200} disabled={dis} {...register("title")} />
              </Field>
            </div>
            <Field label="SDG Goal" htmlFor="sdg" error={errors.sdg?.message}>
              <Input id="sdg" list="sdg-goals" placeholder="1. No Poverty" maxLength={100} disabled={dis} {...register("sdg")} />
              <datalist id="sdg-goals">
                {SDG_GOALS.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </Field>
            <Field label="Problem Statement by Guide" htmlFor="problem" error={errors.problem?.message}>
              <Select id="problem" disabled={dis} {...register("problem")}>
                <option value="">Select…</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Student 1</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="s1_name">
              <Input id="s1_name" readOnly value={form.s1_name} className={ro} />
            </Field>
            <Field label="Registration No." htmlFor="s1_reg">
              <Input id="s1_reg" readOnly value={form.s1_reg} className={ro} />
            </Field>
            <Field label="Section" htmlFor="s1_section">
              <Input id="s1_section" readOnly value={form.s1_section ?? ""} className={ro} />
            </Field>
            <Field label="SRM Mail ID" htmlFor="s1_mail" error={errors.s1_mail?.message}>
              <Input id="s1_mail" type="email" disabled={dis} {...register("s1_mail")} />
            </Field>
            <Field label="Mobile No." htmlFor="s1_mobile" error={errors.s1_mobile?.message}>
              <Input id="s1_mobile" inputMode="tel" maxLength={14} disabled={dis} {...register("s1_mobile")} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Student 2</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {form.s2_locked && (
              <p className="text-xs text-muted-foreground sm:col-span-2">Your batch partner, set by your guide. Name, registration number and section cannot be changed.</p>
            )}
            <Field label="Name" htmlFor="s2_name" error={errors.s2_name?.message}>
              <Input id="s2_name" maxLength={100} {...s2(form.s2_locked)} {...register("s2_name")} />
            </Field>
            <Field label="Registration No." htmlFor="s2_reg" error={errors.s2_reg?.message}>
              <Input id="s2_reg" maxLength={30} {...s2(form.s2_locked)} {...register("s2_reg")} />
            </Field>
            <Field label="Section" htmlFor="s2_section" error={errors.s2_section?.message}>
              <Input id="s2_section" maxLength={20} {...s2(form.s2_locked)} {...register("s2_section")} />
            </Field>
            <Field label="SRM Mail ID" htmlFor="s2_mail" error={errors.s2_mail?.message}>
              <Input id="s2_mail" type="email" placeholder="name@srmist.edu.in" disabled={dis} {...register("s2_mail")} />
            </Field>
            <Field label="Mobile No." htmlFor="s2_mobile" error={errors.s2_mobile?.message}>
              <Input id="s2_mobile" inputMode="tel" maxLength={14} disabled={dis} {...register("s2_mobile")} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Guide</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Guide Name" htmlFor="g_name">
              <Input id="g_name" readOnly value={form.guide_name} className={ro} />
            </Field>
            <Field label="Guide Emp ID" htmlFor="g_emp">
              <Input id="g_emp" readOnly value={form.guide_emp_id} className={ro} />
            </Field>
            <Field label="Department" htmlFor="g_department">
              <Input id="g_department" readOnly value={form.guide_department} className={ro} />
            </Field>
            <Field label="Contact Number" htmlFor="g_phone">
              <Input id="g_phone" readOnly value={form.guide_phone ?? ""} className={ro} />
            </Field>
          </CardContent>
        </Card>

        {editable && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" loading={isSubmitting} onClick={() => void save(false)}>
              <Save className="h-4 w-4" /> Save draft
            </Button>
            <Button type="button" onClick={askSubmit}>
              <Send className="h-4 w-4" /> Submit
            </Button>
          </div>
        )}
      </form>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Submit the application?"
        description="Once submitted, neither you nor your team mate can edit it."
        confirmLabel="Submit"
        onConfirm={() => save(true)}
      />
    </>
  );
}
