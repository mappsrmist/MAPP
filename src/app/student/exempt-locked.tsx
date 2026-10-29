import { Lock } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/card";
import { MSG } from "@/lib/config";

/** MOOC and Minor are both locked for a student the admin has exempted (the RPCs refuse them too). */
export function ExemptLocked() {
  return (
    <Card>
      <EmptyState title="Exempted" hint={MSG.EXEMPT} icon={<Lock className="h-8 w-8" aria-hidden />} />
    </Card>
  );
}
