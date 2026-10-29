"use client";

import { BookOpen, ClipboardCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export type LoginRole = "student" | "faculty";

type Step = { title: string; body: string; highlight?: boolean };
const STUDENT_STEPS: Step[] = [
  { title: "First Login", body: "Use your registration number as both your username and your initial password." },
  { title: "Change Your Password", body: "After your first login, change your password. Enter your registration number as your current password, then set a new password.", highlight: true },
  { title: "Choose Your Project Option", body: "Select either MOOC or Minor. MOOC requires a CGPA of 9.00 or above and Faculty Advisor approval. A pending or approved MOOC request locks the Minor page. If you choose Minor, the MOOC page will be locked. Choose carefully, as you cannot access both options simultaneously." },
  { title: "Submit a Minor Request", body: "If you choose Minor, you can send a request to only one faculty member. Review the faculty member's research interests or area of expertise before submitting your request." },
  { title: "Contact the Faculty Member", body: "Use the contact information provided in the portal to contact the faculty member or arrange an in-person meeting." },
  { title: "Wait for Approval", body: "If the faculty member accepts your request, you will be allowed to complete the Minor application form available in your student login." },
  { title: "Complete and Submit the Application", body: "Fill in the application form and download the completed form. Obtain your Guide's signature and submit the signed form to your Faculty Advisor (FA).", highlight: true },
];
const FACULTY_STEPS: Step[] = [
  { title: "First Login", body: "Use your SRM email ID as your username and your employee ID as your initial password." },
  { title: "Change Your Password", body: "After your first login, change your password. Enter your employee ID as your current password, then set a new password.", highlight: true },
  { title: "Student Contact Information", body: "Students can contact you using the phone number provided in your faculty profile or visit your cabin for an in-person discussion." },
  { title: "Review Student Requests", body: "View the students who have approached you through the portal. You may meet them in person before making a decision. Click Accept if you are willing to guide the student or Decline if you do not wish to accept the request.", highlight: true },
  { title: "Group Students into Batches", body: "Use the Batch Grouping feature to organize the students you have accepted into batches. Students can complete the application form only after they have been assigned to a batch, according to the portal's workflow." },
  { title: "Review Student Applications", body: "Students will complete the application form with their project title and other required details. You can review their submitted forms through your faculty login." },
  { title: "Verify and Sign Applications", body: "Students will print their completed application forms and meet you in person to obtain your signature." },
];

export function PortalGuidelines({ role, onRoleChange }: { role: LoginRole; onRoleChange: (role: LoginRole) => void }) {
  const steps = role === "student" ? STUDENT_STEPS : FACULTY_STEPS;
  return (
    <section aria-labelledby="guidelines-heading" className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="border-b p-6 pb-5 sm:px-8 sm:pt-7">
        <div className="mb-2 flex items-center gap-2.5">
          <BookOpen className="h-5 w-5 text-primary" aria-hidden />
          <h2 id="guidelines-heading" className="text-xl font-semibold tracking-tight">Portal Guidelines</h2>
        </div>
        <p className="text-sm text-muted-foreground">Everything you need to know to get started with MAPP.</p>
        <div role="group" aria-label="Guidelines for" className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
          {(["student", "faculty"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={role === value} onClick={() => onRoleChange(value)}
              className={cn("cursor-pointer rounded-lg px-2 py-2.5 text-sm font-medium transition-colors", role === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {value === "student" ? "Student Guidelines" : "Faculty Guidelines"}
            </button>
          ))}
        </div>
      </div>
      <div key={role} role="region" aria-label={role === "student" ? "Student guidelines" : "Faculty guidelines"} tabIndex={0} className="max-h-[36rem] overflow-y-auto overscroll-contain p-6 sm:px-8 lg:max-h-[min(36rem,calc(100dvh-22rem))] lg:min-h-80">
        <h3 className="mb-6 text-sm font-semibold">{role === "student" ? "Student Login and Project Allocation Instructions" : "Faculty Login and Student Management Instructions"}</h3>
        <ol className="space-y-5">
          {steps.map((step, i) => (
            <li key={step.title} className="relative flex gap-4">
              {i < steps.length - 1 && <span aria-hidden className="absolute left-3.5 top-8 -bottom-5 w-px bg-border" />}
              <span aria-hidden className="relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-semibold text-primary">{i + 1}</span>
              <div className={cn("min-w-0 flex-1", step.highlight && "rounded-xl bg-accent/55 px-4 py-3")}>
                <h4 className="mb-1 text-sm font-semibold">{step.title}</h4>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.body.split(/(Accept|Decline)/g).map((part, j) => part === "Accept" || part === "Decline" ? <strong key={j} className="font-semibold text-foreground">{part}</strong> : part)}</p>
              </div>
            </li>
          ))}
        </ol>
        {role === "faculty" && (
          <aside aria-labelledby="advisor-heading" className="mt-7 rounded-xl border border-primary/20 bg-accent/55 p-5">
            <div className="mb-2 flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-primary" aria-hidden /><h3 id="advisor-heading" className="text-sm font-semibold">Faculty Advisor Dashboard</h3></div>
            <p className="text-sm leading-relaxed text-muted-foreground">Faculty Advisors can review MOOC requests, check student details and CGPAs, and approve or decline access. They can also view the Minor and MOOC selection status of students in their assigned class. The dashboard categorizes students into:</p>
            <ul className="my-3 space-y-2 text-sm">
              {["Students who have selected Minor", "Students approved for MOOC", "Students awaiting MOOC approval", "Students who have not selected either option"].map((label) => <li key={label} className="flex items-start gap-2"><Users className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />{label}</li>)}
            </ul>
            <p className="text-sm font-medium">Quickly identify students who have not yet made a selection.</p>
          </aside>
        )}
      </div>
    </section>
  );
}
