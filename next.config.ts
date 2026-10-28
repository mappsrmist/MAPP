import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

// Only our own Supabase project may be contacted from the browser (no wildcard).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!dev && supabaseUrl && new URL(supabaseUrl).protocol !== "https:") {
  throw new Error("Production Supabase connections must use HTTPS.");
}
for (const name of Object.keys(process.env)) {
  if (/^NEXT_PUBLIC_.*(?:SERVICE_ROLE|SECRET|PRIVATE|PASSWORD|API_KEY|ACCESS_TOKEN|OPENAI|ANTHROPIC)/i.test(name)) {
    throw new Error(`Private credentials must not use a public environment name: ${name}`);
  }
}
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (publicKey?.startsWith("sb_secret_")) throw new Error("The browser Supabase key must be publishable, never secret.");
if (publicKey?.split(".").length === 3) {
  try {
    if (JSON.parse(Buffer.from(publicKey.split(".")[1], "base64url").toString()).role === "service_role") {
      throw new Error("The browser Supabase key must not have the service_role role.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("service_role")) throw error;
  }
}
const supabaseOrigins = supabaseUrl ? `${new URL(supabaseUrl).origin} ${new URL(supabaseUrl).origin.replace(/^http/, "ws")}` : "";

// Content-Security-Policy: Next.js needs inline bootstrap scripts, so 'unsafe-inline' is kept for
// scripts; everything else is locked to our own origin + Supabase. 'unsafe-eval'/ws: only in dev (HMR).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigins}${dev ? " ws: http://localhost:* http://127.0.0.1:*" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // authenticated API responses must never be cached by shared caches
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
