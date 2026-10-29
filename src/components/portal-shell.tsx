"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { GraduationCap, KeyRound, LockKeyhole, LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, MessageDialog } from "@/components/ui/dialog";
import { FreezeProvider } from "@/components/freeze";
import { InstitutionHeader } from "@/components/institution-header";
import { ThemeToggle } from "@/components/theme";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const ChangePasswordForm = dynamic(
  () => import("@/components/change-password-form").then((mod) => mod.ChangePasswordForm),
  { loading: () => <p role="status" className="text-sm text-muted-foreground">Loading account settings…</p> },
);

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** When set, clicking shows this pop-up instead of navigating. */
  lockedMessage?: string;
}

export function PortalShell({
  title,
  userName,
  userSub,
  nav,
  frozen = false,
  children,
}: {
  title: string;
  userName: string;
  userSub?: string;
  nav: NavItem[];
  /** The admin's global freeze flag at render time (kept live on the client). */
  frozen?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const menuButton = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const [pwOpen, setPwOpen] = React.useState(false);
  const [locked, setLocked] = React.useState<string | null>(null);

  async function logout() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const sidebar = (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-1 p-3">
      {nav.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const cls = cn(
          "flex min-h-11 items-center gap-3 rounded-lg border border-transparent px-3 py-3 text-sm font-medium transition-colors",
          active ? "border-primary/15 bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        );
        if (item.lockedMessage) {
          return (
            <button key={item.href} type="button" className={cn(cls, "w-full cursor-pointer text-left")} onClick={() => setLocked(item.lockedMessage!)}>
              {item.icon}
              <span className="flex-1">{item.label}</span>
              <LockKeyhole className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </button>
          );
        }
        return (
          <Link key={item.href} href={item.href} className={cls} aria-current={active ? "page" : undefined}>
            {item.icon}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const account = (
    <div className="m-3 mt-auto border-t px-1 pt-4 pb-1">
      <p className="px-3 text-xs font-medium text-muted-foreground">Account</p>
      <Button data-account-settings variant="ghost" className="mt-1 w-full justify-start text-muted-foreground" onClick={() => { setOpen(false); setPwOpen(true); }}>
        <KeyRound className="h-4 w-4" aria-hidden />
        Change password
      </Button>
    </div>
  );

  const brand = (
    <div className="flex items-center gap-3 border-b px-5 py-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <GraduationCap className="h-5 w-5" aria-hidden />
      </span>
      <div className="leading-tight">
        <p className="text-base font-bold tracking-tight">MAPP</p>
        <p className="text-xs text-muted-foreground">{title}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <InstitutionHeader actions={<ThemeToggle />} />
      <div className="mx-auto grid max-w-[1600px] items-start gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-8 lg:px-8 lg:py-8">
        <aside className="sticky top-6 hidden max-h-[calc(100dvh-3rem)] flex-col overflow-y-auto rounded-2xl border bg-card lg:flex">
          {brand}
          {sidebar}
          {account}
        </aside>
        <div className="min-w-0">
          <div className="mb-6 flex min-h-16 flex-wrap items-center gap-3 border-b pb-4">
            <Button ref={menuButton} variant="outline" size="icon" className="lg:hidden" aria-label="Open menu" aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(true)}>
              <Menu className="h-5 w-5" aria-hidden />
            </Button>
            <p className="mr-auto text-sm font-semibold">{title}</p>
            <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-4">
              <div className="min-w-0 text-right leading-tight">
                <p className="max-w-[min(44vw,16rem)] truncate text-sm font-medium">{userName}</p>
                {userSub && <p className="mt-1 max-w-[min(44vw,16rem)] truncate text-xs text-muted-foreground">{userSub}</p>}
              </div>
              <Button variant="ghost" size="icon" aria-label="Sign out" onClick={logout}>
                <LogOut className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>
          <main id="main-content" tabIndex={-1} className="min-w-0 pb-8 focus:outline-none">
            <FreezeProvider initial={frozen}>{children}</FreezeProvider>
          </main>
          <footer className="border-t py-5 text-xs leading-relaxed text-muted-foreground">Department of Computing Technologies · SRMIST</footer>
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent id="mobile-navigation" title="Navigation" onCloseAutoFocus={(event) => { event.preventDefault(); menuButton.current?.focus(); }} className="left-0 top-0 flex h-dvh max-h-dvh w-[min(20rem,calc(100%-2rem))] max-w-none translate-x-0 translate-y-0 flex-col rounded-none border-y-0 border-l-0 p-4 [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}>
            {brand}
            {sidebar}
            {account}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); const target = menuButton.current?.getClientRects().length ? menuButton.current : document.querySelector<HTMLButtonElement>("[data-account-settings]"); target?.focus(); }} title="Change password" description="Enter your current password and choose a new one.">
          {pwOpen && <ChangePasswordForm onDone={() => setPwOpen(false)} />}
        </DialogContent>
      </Dialog>
      <MessageDialog open={locked !== null} onOpenChange={(o) => !o && setLocked(null)} title="Unavailable" message={locked ?? ""} />
    </div>
  );
}
