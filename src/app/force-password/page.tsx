import { ForcePasswordModal } from "@/components/force-password-modal";

// Nothing but the blocking modal is rendered here; the proxy pins flagged users to this route.
export default function ForcePasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <ForcePasswordModal />
    </main>
  );
}
