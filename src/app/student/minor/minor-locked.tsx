"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/card";
import { MessageDialog } from "@/components/ui/dialog";
import { MSG } from "@/lib/config";

export function MinorLocked() {
  const router = useRouter();
  const [open, setOpen] = React.useState(true);
  return (
    <>
      <Card>
        <EmptyState title="Minor Project dashboard unavailable" hint={MSG.MINOR_LOCKED} icon={<Lock className="h-8 w-8" aria-hidden />} />
      </Card>
      <MessageDialog open={open} onOpenChange={setOpen} title="Minor unavailable" message={MSG.MINOR_LOCKED} onClose={() => router.replace("/student/mooc")} />
    </>
  );
}
