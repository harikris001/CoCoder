import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BoltIcon } from "./icons";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-canvas lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-dark px-12 py-10 text-ondark lg:flex lg:flex-col">
        <Link to="/" className="flex items-center gap-2.5 text-[16px] font-bold tracking-tight">
          <BoltIcon className="text-accent" size={22} strokeWidth={2} />
          CoCoder
        </Link>
        <div className="relative z-10 mt-auto max-w-[520px] pb-10">
          <span className="mb-4 inline-flex rounded-full border border-dark-line bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.09em] text-ondark-dim">
            Autonomous coding agents
          </span>
          <h1 className="max-w-[13ch] text-[42px] font-bold leading-[1.08] tracking-tight">
            Close issues. Keep the signal.
          </h1>
          <p className="mt-5 max-w-[46ch] text-[15px] leading-[1.7] text-ondark-dim">
            Watch every run move from issue to pull request, with the work visible at every step.
          </p>
        </div>
        <div className="absolute -bottom-20 -right-20 size-80 rounded-full border border-dark-line opacity-60" />
        <div className="absolute bottom-12 right-20 size-44 rounded-full border border-dark-line opacity-40" />
      </section>
      <section className="flex min-h-screen flex-col px-5 py-7 sm:px-10 lg:px-16">
        <div className="flex items-center gap-2.5 text-[16px] font-bold tracking-tight lg:hidden">
          <BoltIcon className="text-accent" size={22} strokeWidth={2} />
          CoCoder
        </div>
        <div className="m-auto w-full max-w-[410px] py-10">{children}</div>
      </section>
    </main>
  );
}
