import { getStudent } from "@/lib/server/session";
import { MinorClient } from "./minor-client";
import { MinorLocked } from "./minor-locked";
import { ExemptLocked } from "../exempt-locked";

export default async function MinorPage() {
  const { student, user } = await getStudent();

  if (student?.choice === "exempt") return <ExemptLocked />;

  // Enforced server-side: a MOOC student never receives the Minor dashboard (the RPCs refuse them too).
  if (student?.choice === "mooc" || student?.choice === "mooc_pending") return <MinorLocked />;
  return <MinorClient userId={user.id} />;
}
