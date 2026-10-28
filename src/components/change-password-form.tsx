"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { changePasswordSchema } from "@/lib/validators";
import type { z } from "zod";

type Values = z.input<typeof changePasswordSchema>;

export function ChangePasswordForm({ onDone, submitLabel = "Change password" }: { onDone: (redirect?: string) => void; submitLabel?: string }) {
  const [showCurrent, setShowCurrent] = React.useState(false);
  const [showNew, setShowNew] = React.useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(changePasswordSchema) });

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={handleSubmit(async (values) => {
        const res = await fetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = json.error ?? "Could not change password";
          setError(msg.toLowerCase().includes("current") ? "currentPassword" : "newPassword", { message: msg });
          toast.error(msg);
          return;
        }
        toast.success("Password updated");
        onDone(json.redirect);
      })}
    >
      <Field label="Current password" htmlFor="currentPassword" error={errors.currentPassword?.message}>
        <div className="relative">
          <Input
            id="currentPassword"
            type={showCurrent ? "text" : "password"}
            autoComplete="current-password"
            className="pr-10"
            {...register("currentPassword")}
          />
          <button
            type="button"
            onClick={() => setShowCurrent((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            aria-label={showCurrent ? "Hide current password" : "Show current password"}
          >
            {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>
      <Field label="New password (10+ characters, letters and numbers)" htmlFor="newPassword" error={errors.newPassword?.message}>
        <div className="relative">
          <Input
            id="newPassword"
            type={showNew ? "text" : "password"}
            autoComplete="new-password"
            className="pr-10"
            {...register("newPassword")}
          />
          <button
            type="button"
            onClick={() => setShowNew((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            aria-label={showNew ? "Hide new password" : "Show new password"}
          >
            {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>
      <Button type="submit" className="w-full" loading={isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
