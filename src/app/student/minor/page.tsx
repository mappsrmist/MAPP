import { requireRole } from "@/lib/server/session";
import { MinorClient } from "./minor-client";
import { MinorLocked } from "./minor-locked";

export default async function MinorPage() {
  const { supabase, user } = await requireRole("student");
  const { data: student } = await supabase.from("students").select("choice").eq("id", user.id).single();

  // Enforced server-side: a MOOC student never receives the Minor dashboard (the RPCs refuse them too).
  if (student?.choice === "mooc") return <MinorLocked />;
  return <MinorClient />;
}
