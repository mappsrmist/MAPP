import { getGlobalFrozen, getStudent, requireRole } from "@/lib/server/session";
import { StudentShell } from "./student-shell";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const { student, user } = await getStudent();
  const { supabase } = await requireRole("student");
  const [frozen, accepted] = await Promise.all([
    getGlobalFrozen("student"),
    supabase.from("batch_members").select("batch_id").eq("student_id", user.id).eq("project_type", "minor").limit(1),
  ]);

  return (
    <StudentShell
      userId={user.id}
      name={student?.name ?? "Student"}
      regNo={student?.reg_no ?? ""}
      choice={student?.choice ?? null}
      accepted={(accepted.data?.length ?? 0) > 0}
      frozen={frozen}
    >
      {children}
    </StudentShell>
  );
}
