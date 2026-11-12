import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PORTAL_HOME, type Role } from "@/lib/config";

const SECTIONS = ["student", "faculty", "admin"];

/**
 * Maintenance mode: OFF by default. Set MAINTENANCE_MODE=on (also accepts true/1/yes) in the environment and
 * redeploy to close the portal. While on, no auth/DB call is made at all. Read per request, not at startup.
 */
const maintenanceOn = () => ["on", "true", "1", "yes"].includes((process.env.MAINTENANCE_MODE ?? "").trim().toLowerCase());

/**
 * Route protection (Next.js 16 "proxy", formerly middleware):
 *  - unauthenticated users go to /login
 *  - users flagged must_change_password are pinned to /force-password
 *  - each role can only see its own /student, /faculty or /admin tree
 * Pages and RPCs re-check all of this server-side; this is the first gate, not the only one.
 */
export async function proxy(request: NextRequest) {
  if (maintenanceOn()) {
    const { pathname } = request.nextUrl;
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Under maintenance. Please try again later." },
        { status: 503, headers: { "Retry-After": "3600", "Cache-Control": "no-store" } },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/maintenance";
    url.search = "";
    return NextResponse.rewrite(url, { status: 503, headers: { "Retry-After": "3600", "Cache-Control": "no-store" } });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: { secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const redirect = (to: string) => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = "";
    const res = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  const path = request.nextUrl.pathname;
  if (!(path === "/" || path === "/login" || path === "/force-password" || SECTIONS.includes(path.split("/")[1] ?? ""))) {
    return NextResponse.next({ request });
  }
  const first = path.split("/")[1] ?? "";
  const isPortal = SECTIONS.includes(first);
  const isForce = path === "/force-password";

  // Local JWT verification (also refreshes an expiring session); no Auth-server round trip per request.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (!userId) {
    return isPortal || isForce ? redirect("/login") : response;
  }

  // Fast path: for sub-route navigations within portal sections (e.g. /student/minor -> /student/application),
  // skip the redundant profiles DB lookup in middleware. Each portal layout already strictly
  // enforces role isolation and password-change flags via requireRole().
  if (isPortal && path !== "/" && path !== "/login" && !isForce) {
    return response;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) {
    await supabase.auth.signOut();
    return isPortal || isForce ? redirect("/login") : response;
  }

  const role = profile.role as Role;
  const home = PORTAL_HOME[role];

  if (profile.must_change_password) {
    return isForce ? response : redirect("/force-password");
  }
  if (isForce || path === "/login" || path === "/") return redirect(home);
  if (isPortal && first !== role) return redirect(home);
  return response;
}

export const config = {
  // Maintenance mode needs to catch everything except static assets; normal mode only acts on the routes below.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|apple-icon.png|brand/).*)"],
};
