import { getStudent, requireRole } from "@/lib/server/session";
import { MoocClient } from "./mooc-client";
import { ExemptLocked } from "../exempt-locked";

export default async function MoocPage() {
  const { student } = await getStudent();
  if (student?.choice === "exempt") return <ExemptLocked />;
  const { supabase } = await requireRole("student");
  const { data, error } = await supabase.from("mooc_requests").select("id,cgpa,status,requested_at").order("requested_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Could not load your MOOC request. Please try again.");
  return <MoocClient choice={student?.choice ?? null} request={data} />;
}
