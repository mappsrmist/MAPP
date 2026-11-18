import { StudentDetailClient } from "./student-detail-client";

export default async function AdminStudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StudentDetailClient id={id} />;
}
