import { AlertTriangle } from "lucide-react";

export function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
      <div className="flex items-center gap-2 text-red-500">
        <AlertTriangle className="h-4 w-4" />
        <span className="font-medium">{title}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground break-words">{message}</p>
    </div>
  );
}