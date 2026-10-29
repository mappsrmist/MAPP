import { ClipboardList, GraduationCap, Layers, UsersRound } from "lucide-react";
import { PortalShell, type NavItem } from "@/components/portal-shell";
import { redirect } from "next/navigation";
import { FACULTY_COLS } from "@/lib/config";
import { getGlobalFrozen, requireRole } from "@/lib/server/session";
import type { FacultyRow } from "@/lib/types";
import { FacultyProvider } from "./faculty-context";

export default async function FacultyLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await requireRole("faculty");
  const [{ data: faculty }, { data: isAdvisor }] = await Promise.all([
    supabase.from("faculty").select(FACULTY_COLS).eq("id", user.id).single(),
    supabase.rpc("is_faculty_advisor"),
  ]);
  if (!faculty) redirect("/login"); // signed in but no faculty record
  const frozen = await getGlobalFrozen("faculty");

  const nav: NavItem[] = [
    { href: "/faculty/approached", label: "Students Approached", icon: <UsersRound className="h-4 w-4" /> },
    { href: "/faculty/batches", label: "Batch Grouping", icon: <Layers className="h-4 w-4" /> },
    { href: "/faculty/applications", label: "Applications", icon: <ClipboardList className="h-4 w-4" /> },
    // only faculty mapped to at least one section ever see this item
    ...(isAdvisor ? [{ href: "/faculty/advisor", label: "Faculty Advisor", icon: <GraduationCap className="h-4 w-4" /> }] : []),
  ];

  return (
    <PortalShell title="Faculty Portal" userName={faculty?.name ?? "Faculty"} userSub={faculty?.emp_id} nav={nav} frozen={frozen}>
      <FacultyProvider initial={faculty as unknown as FacultyRow}>{children}</FacultyProvider>
    </PortalShell>
  );
}
