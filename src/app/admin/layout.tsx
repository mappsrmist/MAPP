import { LayoutDashboard, Upload } from "lucide-react";
import { PortalShell, type NavItem } from "@/components/portal-shell";
import { requireRole } from "@/lib/server/session";

const NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
  { href: "/admin/import", label: "Import data", icon: <Upload className="h-4 w-4" /> },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole("admin");
  return (
    <PortalShell title="Admin Portal" userName="Administrator" userSub="mappCtech" nav={NAV}>
      {children}
    </PortalShell>
  );
}
