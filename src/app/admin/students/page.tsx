import { StudentsClient, type StudentsTab } from "./students-client";

const TABS: StudentsTab[] = ["section", "mooc_pending", "mooc", "not_opted", "allocations", "exempt", "removed"];

export default async function AdminStudentsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const initialTab = TABS.find((t) => t === tab) ?? "section";
  return <StudentsClient initialTab={initialTab} />;
}
