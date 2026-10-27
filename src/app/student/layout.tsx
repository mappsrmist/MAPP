import { BookOpenCheck, FlaskConical } from "lucide-react";
import { PortalShell, type NavItem } from "@/components/portal-shell";
import { MSG } from "@/lib/config";
import { requireRole } from "@/lib/server/session";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await requireRole("student");
  const { data: student } = await supabase.from("students").select("name, reg_no, choice").eq("id", user.id).single();

  const nav: NavItem[] = [
    { href: "/student/mooc", label: "MOOC", icon: <BookOpenCheck className="h-4 w-4" /> },
    {
      href: "/student/minor",
      label: "Minor",
      icon: <FlaskConical className="h-4 w-4" />,
      // server-derived: the Minor page itself and the RPCs re-check this
      lockedMessage: student?.choice === "mooc" ? MSG.MINOR_LOCKED : undefined,
    },
  ];

  return (
    <PortalShell title="Student Portal" userName={student?.name ?? "Student"} userSub={student?.reg_no} nav={nav}>
      {children}
    </PortalShell>
  );
}
