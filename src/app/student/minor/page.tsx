import { getStudent } from "@/lib/server/session";
import { MinorClient } from "./minor-client";
import { MinorLocked } from "./minor-locked";

export default async function MinorPage() {
  const { student, user } = await getStudent();

  // Enforced server-side: a MOOC student never receives the Minor dashboard (the RPCs refuse them too).
  if (student?.choice === "mooc") return <MinorLocked />;
  return <MinorClient userId={user.id} />;
}
