import { getStudent } from "@/lib/server/session";
import { MoocClient } from "./mooc-client";
import { ExemptLocked } from "../exempt-locked";

export default async function MoocPage() {
  const { student } = await getStudent();
  if (student?.choice === "exempt") return <ExemptLocked />;
  return <MoocClient choice={student?.choice ?? null} />;
}
