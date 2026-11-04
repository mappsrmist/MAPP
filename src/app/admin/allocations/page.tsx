import { redirect } from "next/navigation";

// Allocations now live on the Students page (Minor allocations tab); keep old links working.
export default function AdminAllocationsPage() {
  redirect("/admin/students?tab=allocations");
}
