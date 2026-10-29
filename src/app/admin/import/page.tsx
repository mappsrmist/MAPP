import { ImportClient } from "./import-client";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <ImportClient initialKind={tab === "advisors" || tab === "faculty" ? tab : "students"} />;
}
