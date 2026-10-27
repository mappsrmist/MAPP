"use client";

import { useRouter } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChangePasswordForm } from "@/components/change-password-form";
import { MSG } from "@/lib/config";

/** Non-dismissable: no close button, Esc and outside clicks are ignored. */
export function ForcePasswordModal() {
  const router = useRouter();
  return (
    <Dialog open>
      <DialogContent dismissible={false} title="Change your password" description={MSG.FORCE_PASSWORD}>
        <ChangePasswordForm
          submitLabel="Update password & continue"
          onDone={(redirect) => {
            router.replace(redirect ?? "/");
            router.refresh();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
