import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { AppHeader } from "./AppHeader";

interface Props {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}

export function PageShell({ title, subtitle, right, children }: Props) {
  // `key` pe pathname repornește animația CSS la fiecare schimbare de rută —
  // fără el, clasa rămâne aplicată și animația rulează o singură dată, la montare.
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="relative min-h-screen bg-background pb-24">
      <div className="ambient-orbs" aria-hidden />
      <AppHeader title={title} subtitle={subtitle} right={right} />
      <main
        key={pathname}
        className="page-enter relative z-10 mx-auto max-w-2xl px-4 py-4 space-y-4 stagger-in"
      >
        {children}
      </main>
    </div>
  );
}
