import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/test")({
  head: () => ({ meta: [{ title: "Test — Monitor Server" }] }),
  component: TestPage,
});

function TestPage() {
  return (
    <PageShell title="Test" subtitle="Pagină de verificare">
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-card p-10 text-center">
        <Button size="lg" onClick={() => toast.success("Totul funcționează!")}>
          <CheckCircle2 className="h-4 w-4" />
          Testează
        </Button>
      </div>
    </PageShell>
  );
}
