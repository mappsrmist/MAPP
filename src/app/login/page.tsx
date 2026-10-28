"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, GraduationCap, ShieldCheck, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form";
import { ThemeToggle } from "@/components/theme";
import type { Role } from "@/lib/config";
import { cn } from "@/lib/utils";

const TABS: { role: Role; label: string; icon: React.ReactNode; userLabel: string; placeholder: string }[] = [
  { role: "student", label: "Student", icon: <GraduationCap className="h-4 w-4" />, userLabel: "Registration number", placeholder: "RA2411003010058" },
  { role: "faculty", label: "Faculty", icon: <Users className="h-4 w-4" />, userLabel: "SRM mail ID", placeholder: "name@srmist.edu.in" },
  { role: "admin", label: "Admin", icon: <ShieldCheck className="h-4 w-4" />, userLabel: "Username", placeholder: "mappCtech" },
];

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = React.useState<Role>("student");
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
    <main className="relative flex min-h-screen items-center justify-center p-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
            <GraduationCap className="h-7 w-7" aria-hidden />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">MAPP</h1>
          <p className="text-sm text-muted-foreground">Minor and Major Project Allocation Portal</p>
        </div>

        <Card className="p-6 shadow-lg">
          <div role="tablist" aria-label="Sign in as" className="mb-5 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
            {TABS.map((t) => (
              <button
                key={t.role}
                role="tab"
                type="button"
                aria-selected={role === t.role}
                onClick={() => {
                  setRole(t.role);
                  setError(null);
                  setUsername("");
                  setPassword("");
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

          <form onSubmit={onSubmit} className="space-y-4" role="tabpanel">
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
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
      </div>
    </main>
  );
}
