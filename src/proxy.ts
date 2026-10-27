import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PORTAL_HOME, type Role } from "@/lib/config";
import { isMock, MOCK_COOKIE } from "@/lib/mock/client";

const SECTIONS = ["student", "faculty", "admin"];

/**
 * Route protection (Next.js 16 "proxy", formerly middleware):
 *  - unauthenticated users go to /login
 *  - users flagged must_change_password are pinned to /force-password
 *  - each role can only see its own /student, /faculty or /admin tree
 * Pages and RPCs re-check all of this server-side; this is the first gate, not the only one.
 */
export async function proxy(request: NextRequest) {
  if (isMock()) return mockProxy(request);
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
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
  const first = path.split("/")[1] ?? "";
  const isPortal = SECTIONS.includes(first);
  const isForce = path === "/force-password";

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return isPortal || isForce ? redirect("/login") : response;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", user.id)
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

/** DEV-ONLY mock session: same routing rules, identity from the mock cookie. */
function mockProxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const first = path.split("/")[1] ?? "";
  const isPortal = SECTIONS.includes(first);
  const role = request.cookies.get(MOCK_COOKIE)?.value.split(".")[0] as Role | undefined; // "<role>.<id>"
  const profile = role && role in PORTAL_HOME ? { role } : null;
  const go = (to: string) => NextResponse.redirect(new URL(to, request.url));
  if (!profile) return isPortal || path === "/force-password" ? go("/login") : NextResponse.next();
  const home = PORTAL_HOME[profile.role as Role];
  if (path === "/" || path === "/login" || path === "/force-password") return go(home);
  if (isPortal && first !== profile.role) return go(home);
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/force-password", "/student/:path*", "/faculty/:path*", "/admin/:path*"],
};
