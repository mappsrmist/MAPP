"use client";

import * as React from "react";
import { BookOpenCheck, FileText, FlaskConical } from "lucide-react";
import { PortalShell, type NavItem } from "@/components/portal-shell";
import { MSG } from "@/lib/config";
import { useRealtime } from "@/lib/hooks";
import { createClient } from "@/lib/supabase/client";

interface Props {
  userId: string;
  name: string;
  regNo: string;
  choice: "mooc" | "minor" | null;
  /** the student has a Minor request that a guide accepted */
  accepted: boolean;
  frozen: boolean;
  children: React.ReactNode;
}

/**
 * Student sidebar. The locks are derived from the database (server-rendered first, then kept live), and every
 * locked page is also refused by the RPCs: this only decides which pop-up to show.
 */
export function StudentShell({ userId, name, regNo, choice, accepted, frozen, children }: Props) {
  const [live, setLive] = React.useState<{ choice: Props["choice"]; accepted: boolean } | null>(null);

  const load = React.useCallback(async () => {
    const supabase = createClient();
    const [s, r] = await Promise.all([
      supabase.from("students").select("choice").eq("id", userId).maybeSingle(),
      supabase.from("requests").select("id").eq("student_id", userId).eq("project_type", "minor").eq("status", "accepted").limit(1),
    ]);
    if (s.error || r.error) return;
    setLive({ choice: (s.data?.choice as Props["choice"]) ?? null, accepted: (r.data?.length ?? 0) > 0 });
  }, [userId]);

  useRealtime([{ table: "requests", filter: `student_id=eq.${userId}` }, { table: "students", filter: `id=eq.${userId}` }], () => void load());

  const state = live ?? { choice, accepted };
  const nav: NavItem[] = [
    { href: "/student/mooc", label: "MOOC", icon: <BookOpenCheck className="h-4 w-4" /> },
    {
      href: "/student/minor",
      label: "Minor",
      icon: <FlaskConical className="h-4 w-4" />,
      lockedMessage: state.choice === "mooc" ? MSG.MINOR_LOCKED : undefined,
    },
    {
      href: "/student/application",
      label: "Application Form",
      icon: <FileText className="h-4 w-4" />,
      lockedMessage: state.accepted ? undefined : MSG.APPLICATION_LOCKED,
    },
  ];

  return (
    <PortalShell title="Student Portal" userName={name} userSub={regNo} nav={nav} frozen={frozen}>
      {children}
    </PortalShell>
  );
}
