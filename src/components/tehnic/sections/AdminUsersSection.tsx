import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { listAdminUsers, addAdminUser, deleteAdminUser } from "@/lib/admin.functions";

export function AdminUsersSection() {
  const listFn = useServerFn(listAdminUsers);
  const addFn = useServerFn(addAdminUser);
  const deleteFn = useServerFn(deleteAdminUser);
  const qc = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["adminUsers"],
    queryFn: () => listFn(),
  });

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const addMutation = useMutation({
    mutationFn: () => addFn({ data: { username, password } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error ?? "Adăugare eșuată");
        return;
      }
      toast.success(`Cont adăugat: ${username}`);
      setUsername("");
      setPassword("");
      qc.invalidateQueries({ queryKey: ["adminUsers"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteFn({ data: { id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error ?? "Ștergere eșuată");
        return;
      }
      toast.success("Cont șters");
      qc.invalidateQueries({ queryKey: ["adminUsers"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5" /> Conturi Admin
      </h2>

      <div className="rounded-2xl border border-border bg-card divide-y divide-border/50">
        {isLoading ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">Se încarcă...</div>
        ) : users.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">Niciun cont.</div>
        ) : (
          users.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{u.username}</div>
                <div className="text-[11px] text-muted-foreground">
                  Creat {new Date(u.createdAt).toLocaleDateString("ro-RO")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Ștergi contul "${u.username}"?`)) deleteMutation.mutate(u.id);
                }}
                disabled={deleteMutation.isPending || users.length <= 1}
                title={users.length <= 1 ? "Nu poți șterge singurul cont" : "Șterge contul"}
                className="shrink-0 rounded-md border border-red-500/30 bg-red-500/10 p-1.5 text-red-400 hover:bg-red-500/20 transition disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          addMutation.mutate();
        }}
        className="rounded-2xl border border-border bg-card p-3 space-y-2"
      >
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          <UserPlus className="h-3.5 w-3.5" /> Adaugă cont nou
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Utilizator"
            autoComplete="off"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="Parolă (min. 8 caractere)"
            autoComplete="new-password"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <button
          type="submit"
          disabled={addMutation.isPending || !username || password.length < 8}
          className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {addMutation.isPending ? "Se adaugă..." : "Adaugă cont"}
        </button>
      </form>
    </section>
  );
}
