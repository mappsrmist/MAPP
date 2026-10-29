/**
 * Student demo. Part 1: Arjun's first login and MOOC request, approved by the Faculty Advisor off camera.
 * Part 2: Sneha approaches a guide, is grouped off camera, then fills, submits and downloads the Application Form.
 * Usage: npm run record:student   (resets the demo data first; the app must be running at BASE_URL)
 */
import type { Page } from "playwright";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { assemble } from "./assemble";
import { cleanup } from "./cleanup";
import { DEMO_PASSWORD, GUIDE2, PARTNER_B, STUDENT_A, STUDENT_B } from "./demo-data";
import { acceptAndGroup, approveMooc } from "./offcamera";
import { BASE_URL, RAW_DIR } from "./paths";
import { click, pause, record, type, type Step } from "./recorder";
import { seed } from "./seed";
import { isMain } from "./supabase";

const nav = (page: Page, label: string) => page.getByRole("navigation", { name: "Main" }).getByText(label, { exact: true });
const pdfPath = join(RAW_DIR, "application.pdf");
const pdfPng = join(RAW_DIR, "application-page1.png");

async function signIn(page: Page, username: string, password: string) {
  await click(page, page.getByRole("group", { name: "Sign in as" }).getByRole("button", { name: "Student" }));
  await type(page, page.locator("#username"), username);
  await type(page, page.locator("#password"), password);
  await click(page, page.locator("form button[type=submit]"));
}

/** Waits for text, reloading once if realtime has not delivered the change yet. */
async function waitForText(page: Page, text: string | RegExp, timeout = 15_000) {
  const loc = page.getByText(text).first();
  try {
    await loc.waitFor({ timeout });
  } catch {
    await page.reload();
    await loc.waitFor({ timeout });
  }
  return loc;
}

async function hover(page: Page, target: ReturnType<Page["locator"]>) {
  const box = await target.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
}

const partOne: Step[] = [
  {
    caption: "MAPP: Minor and Major Project Allocation Portal",
    narration:
      "This is MAPP, the Minor and Major Project Allocation Portal of the Department of Computing Technologies. In this demo, we will walk through the portal from a student's point of view.",
    run: async (page) => {
      await page.getByRole("heading", { name: "Welcome to MAPP" }).waitFor();
    },
  },
  {
    caption: "Portal guidelines on the login page",
    narration: "The login page shows the portal guidelines, so every student knows the process before signing in.",
    run: async (page) => {
      await page.mouse.move(1350, 420, { steps: 30 });
      await pause(1);
      await page.mouse.move(1350, 640, { steps: 30 });
    },
  },
  {
    caption: "Student sign-in with registration number",
    narration:
      "Students sign in with their registration number. On the first login, the password is also the registration number.",
    run: (page) => signIn(page, STUDENT_A.reg_no, STUDENT_A.reg_no),
  },
  {
    caption: "First login: set a new password",
    narration:
      "For security, every user must set a new password at the first login. The student enters the current password, and chooses a new one of at least ten characters.",
    run: async (page) => {
      await page.getByRole("dialog", { name: "Change your password" }).waitFor();
      await type(page, page.locator("#currentPassword"), STUDENT_A.reg_no);
      await type(page, page.locator("#newPassword"), DEMO_PASSWORD);
      await click(page, page.getByRole("button", { name: "Update password & continue" }));
      await page.waitForURL(/\/student\/mooc/, { timeout: 30_000 });
    },
  },
  {
    caption: "Student portal: MOOC, Minor and Application Form",
    narration:
      "The student now lands on the portal. The sidebar has three sections: MOOC, Minor project, and the Application Form.",
    run: async (page) => {
      await page.getByRole("heading", { name: "MOOC", exact: true }).waitFor();
      for (const label of ["MOOC", "Minor", "Application Form"]) {
        await hover(page, nav(page, label));
        await pause(0.8);
      }
    },
  },
  {
    caption: "MOOC rules and regulations",
    narration:
      "The MOOC page lists the rules and regulations for MOOC course selection. Students with a CGPA of nine or above may choose a MOOC course instead of a Minor project.",
    run: async (page) => {
      await page.mouse.move(1000, 500, { steps: 20 });
      await page.mouse.wheel(0, 350);
      await pause(2);
      await page.mouse.wheel(0, 400);
    },
  },
  {
    caption: "Accept the rules and submit",
    narration: "After reading the rules, the student accepts them, and clicks Submit.",
    run: async (page) => {
      await click(page, page.getByRole("checkbox"));
      await click(page, page.getByRole("button", { name: "Submit", exact: true }));
    },
  },
  {
    caption: "Enter CGPA and send to the Faculty Advisor",
    narration:
      "The student enters their current CGPA, which must be between nine and ten, and sends the request to their Faculty Advisor for approval.",
    run: async (page) => {
      await type(page, page.locator("#mooc-cgpa"), "9.45");
      await click(page, page.getByRole("button", { name: "Send to Faculty Advisor" }));
      await page.getByRole("dialog", { name: "MOOC request sent" }).waitFor();
    },
  },
  {
    caption: "Request sent to the Faculty Advisor",
    narration: "The request has been sent. MOOC access is granted only after the Faculty Advisor approves it.",
    run: async (page) => {
      await pause(1.5);
      await click(page, page.getByRole("button", { name: "OK" }));
    },
  },
  {
    caption: "Awaiting approval: Minor is locked meanwhile",
    narration:
      "The page now shows the request as awaiting approval. While it is pending, the Minor project section is locked, so a student cannot hold both choices at once.",
    run: async (page) => {
      await waitForText(page, "Awaiting Faculty Advisor approval");
      await page.mouse.wheel(0, -1000);
      await pause(1.5);
      await click(page, nav(page, "Minor"));
      await page.getByRole("dialog", { name: "Unavailable" }).waitFor();
      await pause(2.5);
      await click(page, page.getByRole("button", { name: "OK" }));
    },
  },
  {
    caption: "The Faculty Advisor reviews and approves the request",
    narration:
      "Meanwhile, the Faculty Advisor reviews the student's CGPA and approves the request from the faculty portal. The student's page updates automatically.",
    run: async (page) => {
      await pause(2);
      await approveMooc(STUDENT_A);
      await waitForText(page, "Your MOOC request is approved");
    },
  },
  {
    caption: "MOOC request approved",
    narration:
      "The request is now approved. The student can proceed with MOOC course selection, and the Minor project dashboard remains unavailable.",
    run: async (page) => {
      await hover(page, page.getByText("Your MOOC request is approved"));
    },
  },
  {
    caption: "Sign out",
    narration: "That completes the MOOC journey. The student signs out.",
    run: async (page) => {
      await click(page, page.getByRole("button", { name: "Sign out" }));
      await page.waitForURL(/\/login/);
    },
  },
];

const partTwo: Step[] = [
  {
    caption: "Minor project: a second student signs in",
    narration:
      "Next, a second student, Sneha, chooses a Minor project instead. She has already set her password, so she signs in directly.",
    run: async (page) => {
      await signIn(page, STUDENT_B.reg_no, DEMO_PASSWORD);
      await page.waitForURL(/\/student\/mooc/, { timeout: 30_000 });
    },
  },
  {
    caption: "Faculty list with domains and available seats",
    narration: "On the Minor page, students see every faculty member, with their research domains and available seats.",
    run: async (page) => {
      await click(page, nav(page, "Minor"));
      await page.getByRole("heading", { name: "Minor Project", exact: true }).waitFor();
      await page.getByRole("button", { name: /^Request / }).first().waitFor();
      await page.mouse.move(1100, 600, { steps: 25 });
    },
  },
  {
    caption: "Search by name or filter by domain",
    narration: "Students can search by name or employee ID, or filter the list by research domain.",
    run: async (page) => {
      await type(page, page.getByPlaceholder("Search by name or employee ID"), "Karthik");
      // the search is debounced: wait for the filtered list so the next click doesn't land mid re-render
      await page.waitForFunction(() => document.querySelectorAll('button[aria-label^="Request "]').length <= 3, null, { timeout: 15_000 });
      await pause(0.6);
      await page.getByRole("button", { name: `Request ${GUIDE2.name}` }).waitFor();
      await hover(page, page.getByLabel("Filter by domain"));
    },
  },
  {
    caption: "Faculty details",
    narration: "Opening a faculty member shows their details: domains, venue, contact number, and seats remaining.",
    run: async (page) => {
      await click(page, page.getByRole("button", { name: `Request ${GUIDE2.name}` }));
      await page.getByRole("dialog", { name: GUIDE2.name }).waitFor();
      await page.mouse.move(960, 520, { steps: 20 });
    },
  },
  {
    caption: "Send a request to the guide",
    narration:
      "The student sends a request. Only one request can be active at a time. Another faculty member can be approached only if this one declines.",
    run: async (page) => {
      await click(page, page.getByRole("dialog", { name: GUIDE2.name }).getByRole("button", { name: "Request", exact: true }));
      await page.getByRole("button", { name: "Send request" }).waitFor();
      await pause(1.5);
      await click(page, page.getByRole("button", { name: "Send request" }));
    },
  },
  {
    caption: "Request pending with the guide",
    narration: "The request now shows as pending, along with the guide's contact details. This page updates live.",
    run: async (page) => {
      await waitForText(page, "Your request status. This updates live.");
      await page.mouse.move(900, 450, { steps: 25 });
    },
  },
  {
    caption: "The guide accepts and forms the project batch",
    narration:
      "The guide accepts the request, and groups Sneha with her teammate Rahul into a project batch. Her status changes to accepted.",
    run: async (page) => {
      await pause(2);
      await acceptAndGroup(GUIDE2, [STUDENT_B, PARTNER_B]);
      // the sidebar lock follows batch membership on a timer; a reload picks it up at once
      await page.reload();
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Application Form" }).waitFor({ timeout: 20_000 });
      await waitForText(page, /accepted|grouped/i);
    },
  },
  {
    caption: "Application Form unlocked",
    narration:
      "Once the batch is complete, the Application Form unlocks. The student, teammate, and guide details are filled in automatically from the batch.",
    run: async (page) => {
      await click(page, nav(page, "Application Form"));
      await page.locator("#title").waitFor({ timeout: 30_000 });
      await page.mouse.wheel(0, 500);
      await pause(1.5);
      await page.mouse.wheel(0, -500);
    },
  },
  {
    caption: "Project details and team contact numbers",
    narration:
      "The team enters the project title, the project type, the related Sustainable Development Goal, whether the problem statement was given by the guide, and the team members' contact numbers.",
    run: async (page) => {
      await type(page, page.locator("#title"), "Smart Irrigation Monitoring Using IoT Sensors");
      await click(page, page.locator("#project_type"));
      await page.locator("#project_type").selectOption("product");
      await type(page, page.locator("#sdg"), "6. Clean Water and Sanitation");
      await click(page, page.locator("#problem"));
      await page.locator("#problem").selectOption("yes");
      for (const [id, value] of [["#s1_mail", STUDENT_B.email], ["#s1_mobile", STUDENT_B.mobile], ["#s2_mail", PARTNER_B.email], ["#s2_mobile", PARTNER_B.mobile]] as const) {
        if (!(await page.locator(id).inputValue())) await type(page, page.locator(id), value);
      }
    },
  },
  {
    caption: "Save as draft",
    narration: "The form can be saved as a draft. Both team members can see and edit it until it is submitted.",
    run: async (page) => {
      await click(page, page.getByRole("button", { name: "Save draft" }));
    },
  },
  {
    caption: "Submit the application",
    narration: "When the details are final, the student submits the application.",
    run: async (page) => {
      await click(page, page.getByRole("button", { name: "Submit", exact: true }));
      const dialog = page.getByRole("dialog", { name: "Submit the application?" });
      await dialog.waitFor();
      await pause(1.5);
      await click(page, dialog.getByRole("button", { name: "Submit", exact: true }));
      await waitForText(page, "Submitted");
    },
  },
  {
    caption: "Download the Guide Acceptance Form (PDF)",
    narration: "The Guide Acceptance Form can now be downloaded as a PDF, ready to print and sign.",
    run: async (page) => {
      await page.mouse.wheel(0, -1000);
      const [download] = await Promise.all([page.waitForEvent("download"), click(page, page.getByRole("button", { name: "Download PDF" }))]);
      await download.saveAs(pdfPath);
      await promisify(execFile)("python", ["-c", `import pymupdf;d=pymupdf.open(r"${pdfPath}");d[0].get_pixmap(dpi=130).save(r"${pdfPng}")`]);
    },
  },
  {
    caption: "The generated application form",
    narration: "Here is the generated form, with the project, team, and guide details filled in.",
    run: async (page) => {
      const img = `data:image/png;base64,${readFileSync(pdfPng).toString("base64")}`;
      await page.setContent(
        `<body style="margin:0;background:#525659;display:flex;justify-content:center;overflow:hidden"><img src="${img}" style="height:1040px;margin-top:20px;box-shadow:0 4px 24px rgba(0,0,0,.5)"></body>`,
      );
    },
  },
  {
    caption: "End of the student demo",
    narration: "That concludes the student demo of MAPP. Thank you.",
    run: async () => {},
  },
];

export async function main() {
  await cleanup();
  await seed({ advisorFirstLogin: false }); // the advisor approves off camera here
  const rec = await record("student", `${BASE_URL}/login`, [...partOne, ...partTwo]);
  await assemble("Student", rec, {
    title: "MAPP Student Portal Demo",
    subtitle: "Minor and Major Project Allocation Portal",
    introNarration: "MAPP. Student portal demo.",
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
