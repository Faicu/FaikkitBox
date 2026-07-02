import type { ReactNode } from "react";
import { AppHeader } from "./AppHeader";

interface Props {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}

export function PageShell({ title, subtitle, right, children }: Props) {
  return (
    <div className="min-h-screen bg-background pb-24">
      <AppHeader title={title} subtitle={subtitle} right={right} />
      <main className="mx-auto max-w-2xl px-4 py-4 space-y-4">{children}</main>
    </div>
  );
}