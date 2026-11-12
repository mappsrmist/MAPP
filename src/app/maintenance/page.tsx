import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Under maintenance – MAPP",
  robots: { index: false, follow: false },
};

export default function MaintenancePage() {
  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-muted text-2xl" aria-hidden="true">
          🛠️
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">We&apos;ll be right back</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The Minor and Major Project Allocation Portal is temporarily down for maintenance while we improve performance and stability.
          Your data is safe and nothing has been changed or lost.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">Please check back a little later. Thank you for your patience.</p>
      </div>
    </main>
  );
}
