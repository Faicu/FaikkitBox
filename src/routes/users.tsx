import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, Trash2, UserPlus, UserCheck, Clock, Users, Film } from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import { TehnicSubNav } from "@/components/tehnic/TehnicSubNav";
import { UserDetailDrawer } from "@/components/tehnic/UserDetailDrawer";
import { requireAdminBeforeLoad } from "@/lib/auth/admin-route-guard";
import { addAdminUser, deleteAdminUser } from "@/lib/auth/admin.functions";
import { listUsers, approveUser, deleteUser, type UserAccount } from "@/lib/auth/users.functions";

export const Route = createFileRoute("/users")({
  beforeLoad: requireAdminBeforeLoad,
  head: () => ({ meta: [{ title: "Utilizatori — Monitor Server" }] }),
  component: UsersPage,
});

function UsersPage() {
  const listFn = useServerFn(listUsers);
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => listFn(),
  });
  const users = Array.isArray(data) ? data : [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ["users"] });

  const pending = users.filter((u) => u.status === "pending");
  const approvedUsers = users.filter((u) => u.role === "user" && u.status === "approved");
  const admins = users.filter((u) => u.role === "admin");

  return (
    <PageShell title="Utilizatori" subtitle="Conturi cu acces la aplicație">
      <TehnicSubNav />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-2xl bg-muted/60" />
          ))}
        </div>
      ) : (
        <>
          <PendingSection pending={pending} onChanged={invalidate} onSelect={setSelectedId} />
          <ApprovedUsersSection
            users={approvedUsers}
            onChanged={invalidate}
            onSelect={setSelectedId}
          />
          <AdminSection admins={admins} onChanged={invalidate} onSelect={setSelectedId} />
        </>
      )}

      {selectedId != null && (
        <UserDetailDrawer userId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </PageShell>
  );
}

function PlexLink({ user }: { user: UserAccount }) {
  if (!user.plexUsername) return null;
  return (
    <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-400">
      <Film className="h-3 w-3" /> Plex: {user.plexUsername}
      {user.plexEmail && user.plexEmail !== user.email ? ` · ${user.plexEmail}` : ""}
    </div>
  );
}

function ContactInfo({ user }: { user: UserAccount }) {
  return (
    <div className="text-[11px] text-muted-foreground">
      {[user.email, user.phone].filter(Boolean).join(" · ") || "—"}
    </div>
  );
}

function PendingSection({
  pending,
  onChanged,
  onSelect,
}: {
  pending: UserAccount[];
  onChanged: () => void;
  onSelect: (id: number) => void;
}) {
  const approveFn = useServerFn(approveUser);
  const deleteFn = useServerFn(deleteUser);

  const approveMutation = useMutation({
    mutationFn: (id: number) => approveFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Cont aprobat");
      onChanged();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Cerere respinsă");
      onChanged();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (pending.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-amber-400 flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5" /> Cereri de aprobare ({pending.length})
      </h2>
      <div className="glass-card rounded-2xl divide-y divide-amber-500/15 stagger-in">
        {pending.map((u) => (
          <div
            key={u.id}
            onClick={() => onSelect(u.id)}
            className="flex items-start justify-between gap-2 px-3 py-3 cursor-pointer transition-colors hover:bg-amber-500/10 active:bg-amber-500/15"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{u.username}</div>
              <ContactInfo user={u} />
              <PlexLink user={u} />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  approveMutation.mutate(u.id);
                }}
                disabled={approveMutation.isPending || rejectMutation.isPending}
                title="Aprobă"
                className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-1.5 text-emerald-400 transition-transform hover:bg-emerald-500/20 active:scale-90 disabled:opacity-30"
              >
                <UserCheck className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Respingi cererea lui "${u.username}"?`)) {
                    rejectMutation.mutate(u.id);
                  }
                }}
                disabled={approveMutation.isPending || rejectMutation.isPending}
                title="Respinge"
                className="rounded-md border border-red-500/30 bg-red-500/10 p-1.5 text-red-400 transition-transform hover:bg-red-500/20 active:scale-90 disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ApprovedUsersSection({
  users,
  onChanged,
  onSelect,
}: {
  users: UserAccount[];
  onChanged: () => void;
  onSelect: (id: number) => void;
}) {
  const deleteFn = useServerFn(deleteUser);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Acces revocat");
      onChanged();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5" /> Utilizatori ({users.length})
      </h2>
      <div className="glass-card rounded-2xl divide-y divide-border/50 stagger-in">
        {users.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            Niciun utilizator aprobat.
          </div>
        ) : (
          users.map((u) => (
            <div
              key={u.id}
              onClick={() => onSelect(u.id)}
              className="flex items-start justify-between gap-2 px-3 py-2.5 cursor-pointer transition-colors hover:bg-muted/40 active:bg-muted/50"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{u.username}</div>
                <ContactInfo user={u} />
                <PlexLink user={u} />
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Revoci accesul lui "${u.username}"?`)) deleteMutation.mutate(u.id);
                }}
                disabled={deleteMutation.isPending}
                title="Revocă accesul"
                className="shrink-0 rounded-md border border-red-500/30 bg-red-500/10 p-1.5 text-red-400 transition-transform hover:bg-red-500/20 active:scale-90 disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function AdminSection({
  admins,
  onChanged,
  onSelect,
}: {
  admins: UserAccount[];
  onChanged: () => void;
  onSelect: (id: number) => void;
}) {
  const addFn = useServerFn(addAdminUser);
  const deleteFn = useServerFn(deleteAdminUser);

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
      onChanged();
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
      onChanged();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5" /> Conturi Admin
      </h2>

      <div className="glass-card rounded-2xl divide-y divide-border/50 stagger-in">
        {admins.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">Niciun cont.</div>
        ) : (
          admins.map((u) => (
            <div
              key={u.id}
              onClick={() => onSelect(u.id)}
              className="flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer transition-colors hover:bg-muted/40 active:bg-muted/50"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{u.username}</div>
                <div className="text-[11px] text-muted-foreground">
                  Creat {new Date(u.createdAt).toLocaleDateString("ro-RO")}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Ștergi contul "${u.username}"?`)) deleteMutation.mutate(u.id);
                }}
                disabled={deleteMutation.isPending || admins.length <= 1}
                title={admins.length <= 1 ? "Nu poți șterge singurul cont" : "Șterge contul"}
                className="shrink-0 rounded-md border border-red-500/30 bg-red-500/10 p-1.5 text-red-400 transition-transform hover:bg-red-500/20 active:scale-90 disabled:opacity-30"
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
          className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-transform hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
        >
          {addMutation.isPending ? "Se adaugă..." : "Adaugă cont"}
        </button>
      </form>
    </section>
  );
}
