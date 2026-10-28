import { Layers, UsersRound } from "lucide-react";
import { PortalShell, type NavItem } from "@/components/portal-shell";
import { redirect } from "next/navigation";
import { FACULTY_COLS } from "@/lib/config";
import { getGlobalFrozen, requireRole } from "@/lib/server/session";
import type { FacultyRow } from "@/lib/types";
import { FacultyProvider } from "./faculty-context";

const NAV: NavItem[] = [
  { href: "/faculty/approached", label: "Students Approached", icon: <UsersRound className="h-4 w-4" /> },
  { href: "/faculty/batches", label: "Batch Grouping", icon: <Layers className="h-4 w-4" /> },
];

export default async function FacultyLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await requireRole("faculty");
  const { data: faculty } = await supabase.from("faculty").select(FACULTY_COLS).eq("id", user.id).single();
  if (!faculty) redirect("/login"); // signed in but no faculty record
  const frozen = await getGlobalFrozen("faculty");

  return (
    <PortalShell title="Faculty Portal" userName={faculty?.name ?? "Faculty"} userSub={faculty?.emp_id} nav={NAV} frozen={frozen}>
      <FacultyProvider initial={faculty as unknown as FacultyRow}>{children}</FacultyProvider>
    </PortalShell>
  );
}
