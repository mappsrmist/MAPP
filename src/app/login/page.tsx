"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, GraduationCap, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form";
import { InstitutionHeader } from "@/components/institution-header";
import { ThemeToggle } from "@/components/theme";
import { cn } from "@/lib/utils";
import { PortalGuidelines, type LoginRole } from "./portal-guidelines";

type Tab = LoginRole;
const TABS: { role: Tab; label: string; icon: React.ReactNode; userLabel: string; placeholder: string }[] = [
  { role: "student", label: "Student", icon: <GraduationCap className="h-4 w-4" />, userLabel: "Registration Number", placeholder: "RA2411003010058" },
  { role: "faculty", label: "Faculty", icon: <Users className="h-4 w-4" />, userLabel: "SRM Email ID", placeholder: "name@srmist.edu.in" },
];

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = React.useState<Tab>("student");
  const [guidelinesRole, setGuidelinesRole] = React.useState<LoginRole>("student");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const tab = TABS.find((t) => t.role === role)!;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, username, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? (res.status === 500 ? "Server configuration error. Please check server logs and environment variables." : "Could not sign in"));
        return;
      }
      toast.success("Signed in");
      router.replace(json.redirect);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main-content" className="min-h-screen">
      <InstitutionHeader actions={<ThemeToggle />} />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8 sm:py-10 lg:py-12">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-8">
        <Card className="p-6 sm:p-8 lg:sticky lg:top-8">
          <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-accent-foreground"><GraduationCap className="h-6 w-6" aria-hidden /></span>
          <h1 id="login-heading" className="text-2xl font-semibold tracking-tight">Welcome to MAPP</h1>
          <p className="mt-2 mb-7 text-sm text-muted-foreground">Sign in to access your project allocation portal.</p>
          <div role="group" aria-label="Sign in as" className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
            {TABS.map((t) => (
              <button
                key={t.role}
                type="button"
                aria-pressed={role === t.role}
                onClick={() => {
                  setRole(t.role);
                  setGuidelinesRole(t.role);
                  setError(null);
                  setUsername("");
                  setPassword("");
                  setShowPassword(false);
                }}
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
                  role === t.role ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-4" aria-labelledby="login-heading">
            <div>
              <Label htmlFor="username">{tab.userLabel}</Label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input id="username" className="pl-9" autoComplete="username" placeholder={tab.placeholder} value={username} onChange={(e) => setUsername(e.target.value)} required />
              </div>
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" size="lg" loading={busy}>
              Sign in as {tab.label}
            </Button>
          </form>
        </Card>
          <PortalGuidelines role={guidelinesRole} onRoleChange={setGuidelinesRole} />
        </div>
        <footer className="mt-8 border-t pt-5 text-center text-xs text-muted-foreground">Department of Computing Technologies · SRMIST</footer>
      </div>
    </main>
  );
}
