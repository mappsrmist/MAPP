"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { GraduationCap, KeyRound, LogOut, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, MessageDialog } from "@/components/ui/dialog";
import { FreezeProvider } from "@/components/freeze";
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
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
          active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        );
        if (item.lockedMessage) {
          return (
            <button key={item.href} type="button" className={cn(cls, "w-full cursor-pointer text-left")} onClick={() => setLocked(item.lockedMessage!)}>
              {item.icon}
              {item.label}
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
      <Button variant="ghost" className="mt-1 w-full justify-start text-muted-foreground" onClick={() => { setOpen(false); setPwOpen(true); }}>
        <KeyRound className="h-4 w-4" aria-hidden />
        Change password
      </Button>
    </div>
  );

  const brand = (
    <div className="flex h-16 items-center gap-2 border-b px-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <GraduationCap className="h-5 w-5" aria-hidden />
      </span>
      <div className="leading-tight">
        <p className="text-base font-bold tracking-tight">MAPP</p>
        <p className="text-[11px] text-muted-foreground">{title}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-card lg:flex">
        {brand}
        {sidebar}
        {account}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside
            className="absolute inset-y-0 left-0 flex w-64 flex-col bg-card shadow-xl"
            onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}
          >
            <div className="flex items-center justify-between pr-2">
              {brand}
              <Button variant="ghost" size="icon" aria-label="Close menu" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            {sidebar}
            {account}
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b bg-card/90 px-4 backdrop-blur lg:px-8">
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
          <Menu className="h-5 w-5" />
        </Button>
        <p className="hidden text-sm font-medium text-muted-foreground lg:block">{title}</p>
        <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-3">
          <div className="mr-2 min-w-0 border-r pr-4 text-right leading-tight">
            <p className="max-w-[16rem] truncate text-sm font-medium">{userName}</p>
            {userSub && <p className="max-w-[16rem] truncate text-xs text-muted-foreground">{userSub}</p>}
          </div>
          <ThemeToggle />
          <Button variant="ghost" size="sm" aria-label="Sign out" onClick={logout}>
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <FreezeProvider initial={frozen}>{children}</FreezeProvider>
      </main>

      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent title="Change password" description="Enter your current password and choose a new one.">
          {pwOpen && <ChangePasswordForm onDone={() => setPwOpen(false)} />}
        </DialogContent>
      </Dialog>
      <MessageDialog open={locked !== null} onOpenChange={(o) => !o && setLocked(null)} title="Unavailable" message={locked ?? ""} />
    </div>
  );
}
