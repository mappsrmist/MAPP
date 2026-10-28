import { getStudent } from "@/lib/server/session";
import { MoocClient } from "./mooc-client";

export default async function MoocPage() {
  const { student } = await getStudent();
  return <MoocClient choice={student?.choice ?? null} />;
}
