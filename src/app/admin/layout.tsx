import { ClipboardList, GraduationCap, LayoutDashboard, Settings, Upload, Users } from "lucide-react";
import { PortalShell, type NavItem } from "@/components/portal-shell";
import { getGlobalFrozen, requireRole } from "@/lib/server/session";

const NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
  { href: "/admin/faculty", label: "Faculty", icon: <Users className="h-4 w-4" /> },
  { href: "/admin/allocations", label: "Allocations", icon: <ClipboardList className="h-4 w-4" /> },
  { href: "/admin/advisors", label: "Faculty Advisors", icon: <GraduationCap className="h-4 w-4" /> },
  { href: "/admin/import", label: "Import data", icon: <Upload className="h-4 w-4" /> },
  { href: "/admin/settings", label: "Settings & Freeze", icon: <Settings className="h-4 w-4" /> },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole("admin");
  const frozen = await getGlobalFrozen("admin");
  return (
    <PortalShell title="Admin Portal" userName="Administrator" userSub="mappCtech" nav={NAV} frozen={frozen}>
      {children}
    </PortalShell>
  );
}
