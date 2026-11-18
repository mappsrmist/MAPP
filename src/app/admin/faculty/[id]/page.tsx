import { FacultyDetailClient } from "./faculty-detail-client";

export default async function AdminFacultyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FacultyDetailClient id={id} />;
}
