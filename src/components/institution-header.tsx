import Image from "next/image";
import type { ReactNode } from "react";

/** Shared institutional identity for sign-in, account setup, and every portal. */
export function InstitutionHeader({ actions }: { actions?: ReactNode }) {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto grid max-w-[1600px] grid-cols-[1fr_1fr_auto] items-center gap-x-4 gap-y-4 px-4 py-5 sm:px-6 lg:grid-cols-[190px_minmax(0,1fr)_190px_auto] lg:gap-6 lg:px-8 lg:py-6">
        <div className="brand-plate justify-self-start">
          <Image src="/brand/srm-logo.png" alt="SRM Institute of Science and Technology" width={543} height={162} priority className="h-auto w-32 sm:w-40 lg:w-44" />
        </div>
        <div className="col-span-3 row-start-2 text-center lg:col-span-1 lg:col-start-2 lg:row-start-1">
          <p className="text-sm font-semibold leading-snug tracking-wide sm:text-base lg:text-lg">DEPARTMENT OF COMPUTING TECHNOLOGIES</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">Minor and Major Project Allocation Portal (MAPP)</p>
        </div>
        <div className="brand-plate col-start-2 row-start-1 justify-self-end lg:col-start-3">
          <Image src="/brand/ctech-logo.png" alt="CTECH — Department of Computing Technologies" width={383} height={173} priority className="h-auto w-28 sm:w-36 lg:w-40" />
        </div>
        <div className="col-start-3 row-start-1 lg:col-start-4">{actions}</div>
      </div>
    </header>
  );
}
