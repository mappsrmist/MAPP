import { InstitutionHeader } from "@/components/institution-header";
import { ThemeToggle } from "@/components/theme";
import { ForcePasswordModal } from "@/components/force-password-modal";

// Nothing but the blocking modal is rendered here; the proxy pins flagged users to this route.
export default function ForcePasswordPage() {
  return (
    <main id="main-content" className="min-h-screen bg-background">
      <InstitutionHeader actions={<ThemeToggle />} />
      <ForcePasswordModal />
    </main>
  );
}
