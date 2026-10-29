/**
 * Faculty demo, recorded with Dr. Priya Raman (a guide who is also the Faculty Advisor of the demo section):
 * first login, Students Approached, Batch Grouping, then MOOC approvals and the class overview.
 * Usage: npm run record:faculty   (resets the demo data first; the app must be running at BASE_URL)
 */
import type { Locator, Page } from "playwright";
import { assemble } from "./assemble";
import { cleanup } from "./cleanup";
import { ADVISOR, DEMO_PASSWORD, EXTRAS } from "./demo-data";
import { BASE_URL } from "./paths";
import { click, pause, record, type, type Step } from "./recorder";
import { seed } from "./seed";
import { isMain } from "./supabase";

const [ACCEPT1, ACCEPT2, DECLINE_EXAMPLE] = EXTRAS;
const MOOC_STUDENT = EXTRAS[4];

const nav = (page: Page, label: string) => page.getByRole("navigation", { name: "Main" }).getByText(label, { exact: true });
const row = (page: Page, name: string) => page.getByRole("row", { name: new RegExp(name) });
/** The advisor page lists a student twice (requests + class overview); this is the requests table. */
const moocRow = (page: Page, name: string) => page.getByRole("region", { name: "MOOC approval requests" }).getByRole("row", { name: new RegExp(name) });

async function hover(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
}

async function accept(page: Page, name: string) {
  await click(page, row(page, name).getByRole("button", { name: "Accept" }));
  const dialog = page.getByRole("dialog", { name: `Accept ${name}?` });
  await dialog.waitFor();
  await pause(1.2);
  await click(page, dialog.getByRole("button", { name: "Accept" }));
  await dialog.waitFor({ state: "hidden" });
  await row(page, name).getByText(/accepted/i).waitFor({ timeout: 15_000 });
}

/** Picks a student in a batch slot by name and fills any contact field the form could not prefill. */
async function pickStudent(page: Page, slot: "m1" | "m2", student: (typeof EXTRAS)[number]) {
  const select = page.locator(`#${slot}-student`);
  const value = await select.locator("option", { hasText: student.name }).getAttribute("value");
  await click(page, select);
  await select.selectOption(value!);
  await pause(0.8);
  if (!(await page.locator(`#${slot}-contact`).inputValue())) await type(page, page.locator(`#${slot}-contact`), student.mobile);
  if (!(await page.locator(`#${slot}-mail`).inputValue())) await type(page, page.locator(`#${slot}-mail`), student.email);
}

const steps: Step[] = [
  {
    caption: "MAPP: Faculty portal",
    narration:
      "This demo shows the faculty side of MAPP. We sign in as Doctor Priya Raman, who is a project guide, and also the Faculty Advisor of section C1. So one account covers every faculty feature.",
    run: async (page) => {
      await page.getByRole("heading", { name: "Welcome to MAPP" }).waitFor();
      await page.mouse.move(1350, 500, { steps: 30 });
    },
  },
  {
    caption: "Faculty sign-in with SRM email ID",
    narration: "Faculty members sign in with their SRM email ID. On the first login, the password is their employee ID.",
    run: async (page) => {
      await click(page, page.getByRole("group", { name: "Sign in as" }).getByRole("button", { name: "Faculty" }));
      await type(page, page.locator("#username"), ADVISOR.srm_email);
      await type(page, page.locator("#password"), ADVISOR.emp_id);
      await click(page, page.locator("form button[type=submit]"));
    },
  },
  {
    caption: "First login: set a new password",
    narration: "As with students, the portal requires a new password at the first login, before anything else can be done.",
    run: async (page) => {
      await page.getByRole("dialog", { name: "Change your password" }).waitFor();
      await type(page, page.locator("#currentPassword"), ADVISOR.emp_id);
      await type(page, page.locator("#newPassword"), DEMO_PASSWORD);
      await click(page, page.getByRole("button", { name: "Update password & continue" }));
      await page.waitForURL(/\/faculty\/approached/, { timeout: 30_000 });
    },
  },
  {
    caption: "Faculty portal: seats and navigation",
    narration:
      "The faculty portal opens with a seat summary: total seats, seats filled, seats available, and batches formed. The sidebar links to Students Approached, Batch Grouping, and, for Faculty Advisors, the Faculty Advisor page.",
    run: async (page) => {
      await page.getByRole("heading", { name: "Students Approached", exact: true }).waitFor();
      await hover(page, page.getByRole("region", { name: "Seat summary" }));
      await pause(1.5);
      for (const label of ["Students Approached", "Batch Grouping", "Faculty Advisor"]) {
        await hover(page, nav(page, label));
        await pause(0.7);
      }
    },
  },
  {
    caption: "Students Approached: requests from students",
    narration:
      "Every student who sends a Minor project request to this faculty appears here, with their registration number, section, and request status.",
    run: async (page) => {
      await row(page, ACCEPT1.name).waitFor();
      await hover(page, row(page, ACCEPT1.name));
      await pause(1);
      await hover(page, row(page, EXTRAS[3].name));
    },
  },
  {
    caption: "Accept a student",
    narration: "To take a student, the faculty clicks Accept and confirms. Each accepted student uses one seat.",
    run: (page) => accept(page, ACCEPT1.name),
  },
  {
    caption: "Accept a second student",
    narration: "A second student is accepted the same way. The seat summary updates immediately.",
    run: async (page) => {
      await accept(page, ACCEPT2.name);
      await hover(page, page.getByRole("region", { name: "Seat summary" }));
    },
  },
  {
    caption: "Declining a request",
    narration:
      "If a request does not fit, the faculty can decline it. The student's Minor page then unlocks, so they can approach another faculty member.",
    run: async (page) => {
      await hover(page, row(page, DECLINE_EXAMPLE.name).getByRole("button", { name: "Decline" }));
      await pause(2);
    },
  },
  {
    caption: "Batch Grouping",
    narration:
      "Accepted students are grouped into project batches of two. The Batch Grouping page shows each batch slot, and the list of all accepted students.",
    run: async (page) => {
      await click(page, nav(page, "Batch Grouping"));
      await page.getByRole("heading", { name: "Batch Grouping", exact: true }).waitFor();
      await page.mouse.move(1100, 450, { steps: 25 });
      await pause(1);
      await hover(page, page.getByRole("heading", { name: "All accepted students" }));
    },
  },
  {
    caption: "Group two accepted students into Batch 1",
    narration:
      "The faculty opens Batch 1 and selects two accepted students. The section, Faculty Advisor, and email fill in automatically, and the contact numbers are added.",
    run: async (page) => {
      await page.mouse.wheel(0, -1000);
      await click(page, page.getByRole("region", { name: "Batches" }).getByRole("button", { name: "Group" }).first());
      await page.getByRole("dialog", { name: "Group Batch 1" }).waitFor();
      await pickStudent(page, "m1", ACCEPT1);
      await pickStudent(page, "m2", ACCEPT2);
    },
  },
  {
    caption: "Batch formed",
    narration:
      "Once saved, the batch is formed. Both students can now fill in their project Application Form, and the batch sheet can be exported to Excel.",
    run: async (page) => {
      const dialog = page.getByRole("dialog", { name: "Group Batch 1" });
      await click(page, dialog.getByRole("button", { name: "Group", exact: true }));
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("region", { name: "Batches" }).getByText(ACCEPT1.name).first().waitFor({ timeout: 15_000 });
      await hover(page, page.getByRole("region", { name: "Batches" }).getByText(ACCEPT1.name).first());
    },
  },
  {
    caption: "Faculty Advisor: MOOC approval requests",
    narration:
      "As Faculty Advisor, Doctor Priya also reviews MOOC requests from her section. Each request shows the student's details and the CGPA they entered.",
    run: async (page) => {
      await click(page, nav(page, "Faculty Advisor"));
      await page.getByRole("heading", { name: "MOOC approval requests" }).waitFor();
      await moocRow(page, MOOC_STUDENT.name).waitFor({ timeout: 15_000 });
      await hover(page, moocRow(page, MOOC_STUDENT.name));
    },
  },
  {
    caption: "Approve a MOOC request",
    narration:
      "After checking the CGPA, the advisor approves the request. The student immediately gets access to MOOC course selection, and their Minor page is locked.",
    run: async (page) => {
      await click(page, moocRow(page, MOOC_STUDENT.name).getByRole("button", { name: "Approve" }));
      const dialog = page.getByRole("dialog", { name: "Approve MOOC request?" });
      await dialog.waitFor();
      await pause(1.2);
      await click(page, dialog.getByRole("button", { name: "Approve" }));
      await dialog.waitFor({ state: "hidden" });
      await moocRow(page, MOOC_STUDENT.name).getByText("Approved").waitFor({ timeout: 15_000 });
    },
  },
  {
    caption: "Class overview of the section",
    narration:
      "Below, the class overview tracks every student in the section: who chose Minor, who has MOOC approved or pending, and who has not opted yet.",
    run: async (page) => {
      const chips = page.getByRole("group", { name: "Filter by status" });
      await chips.scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, 250);
      await hover(page, chips);
      await pause(1);
    },
  },
  {
    caption: "Filter the class by status",
    narration: "The advisor can filter the class by status, for example to see only students who have not opted yet, and follow up with them.",
    run: async (page) => {
      const chips = page.getByRole("group", { name: "Filter by status" });
      await click(page, chips.getByRole("button", { name: /Not opted/ }));
      await pause(2);
      await click(page, chips.getByRole("button", { name: /MOOC approved/ }));
      await pause(1.5);
      await click(page, chips.getByRole("button", { name: /Total/ }));
    },
  },
  {
    caption: "Sign out",
    narration: "That covers the faculty portal: handling requests, forming batches, and advising the section. The faculty member signs out.",
    run: async (page) => {
      await page.mouse.wheel(0, -2000);
      await click(page, page.getByRole("button", { name: "Sign out" }));
      await page.waitForURL(/\/login/);
    },
  },
  {
    caption: "End of the faculty demo",
    narration: "That concludes the faculty demo of MAPP. Thank you.",
    run: async () => {},
  },
];

export async function main() {
  await cleanup();
  await seed({ advisorFirstLogin: true });
  const rec = await record("faculty", `${BASE_URL}/login`, steps);
  await assemble("Faculty", rec, {
    title: "MAPP Faculty Portal Demo",
    subtitle: "Guide and Faculty Advisor features",
    introNarration: "MAPP. Faculty portal demo.",
    outroTitle: "Thank you",
    outroSubtitle: "MAPP – Minor and Major Project Allocation Portal",
  });
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
