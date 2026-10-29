import { notFound } from "next/navigation";
import { requireRole } from "@/lib/server/session";
import { AdvisorClient } from "./advisor-client";

export default async function FacultyAdvisorPage() {
  const { supabase } = await requireRole("faculty");
  // Checked here and again inside every RPC: a faculty member who is not an advisor gets a 404, never the page.
  const { data } = await supabase.rpc("my_fa_sections");
  const sections = (data ?? []) as string[];
  if (sections.length === 0) notFound();
  return <AdvisorClient sections={sections} />;
}
