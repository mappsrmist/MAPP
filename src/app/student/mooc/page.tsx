import { requireRole } from "@/lib/server/session";
import { MoocClient } from "./mooc-client";

export default async function MoocPage() {
  const { supabase, user } = await requireRole("student");
  const { data: student } = await supabase.from("students").select("choice").eq("id", user.id).single();
  return <MoocClient choice={student?.choice ?? null} />;
}
