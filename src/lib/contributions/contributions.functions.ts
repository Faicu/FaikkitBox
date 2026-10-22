import { createServerFn } from "@tanstack/react-start";
import type { DatabaseSync } from "node:sqlite";

import {
  addMonths,
  allocateMonths,
  currentMonth,
  effectiveTarget,
  isMonth,
  monthsRangeLabel,
  validateDeclaration,
  METHOD_LABELS,
  type MonthStatus,
  type PaymentMethod,
} from "./months";

// Toate importurile server (db, auth, jurnal) sunt dinamice, în handler:
// modulul e importat și de client (Acasă, /contributii), iar un import static
// ar trage db.ts în bundle-ul public.

export interface ContributionProgress {
  month: string;
  target: number;
  confirmed: number;
  pending: number;
}

export interface MyPayment {
  id: number;
  months: string[];
  perMonth: number;
  total: number;
  method: PaymentMethod;
  declaredAt: string;
}

export type MyContribution =
  | { kind: "admin"; progress: ContributionProgress; pendingCount: number }
  | {
      kind: "user";
      exempt: boolean;
      status: MonthStatus;
      // Ultima lună acoperită (plătită sau în așteptare) fără goluri de la
      // luna curentă — pentru „Plătit până în ianuarie 2027".
      coveredUntil: string | null;
      pendingPayments: MyPayment[];
      progress: ContributionProgress;
    };

export interface AdminPayment {
  id: number;
  userId: number;
  username: string;
  months: string[];
  // Pentru plățile respinse `months` e gol (lunile s-au eliberat); rămâne
  // câte luni acoperea.
  monthsCount: number;
  perMonth: number;
  total: number;
  method: PaymentMethod;
  status: "pending" | "confirmed" | "rejected";
  note: string | null;
  declaredAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  addedByAdmin: boolean;
}

export interface ContributorRow {
  userId: number;
  username: string;
  exempt: boolean;
  status: MonthStatus;
  amount: number;
}

export interface ContributionsOverview {
  month: string;
  currentMonth: string;
  progress: ContributionProgress;
  // Ținta curentă, cea pe care o modifică formularul (se aplică de la luna
  // curentă înainte), separată de ținta lunii afișate.
  currentTarget: number;
  contributors: ContributorRow[];
  pending: AdminPayment[];
  history: AdminPayment[];
}

async function db(): Promise<DatabaseSync> {
  const { getDb } = await import("../db");
  return getDb();
}

function targetFor(database: DatabaseSync, month: string): number {
  const rows = database.prepare("SELECT month, target FROM contribution_targets").all() as Array<{
    month: string;
    target: number;
  }>;
  return effectiveTarget(month, rows);
}

function progressFor(database: DatabaseSync, month: string): ContributionProgress {
  const rows = database
    .prepare(
      `SELECT p.status AS status, SUM(m.amount) AS sum
         FROM contribution_months m JOIN contribution_payments p ON p.id = m.payment_id
        WHERE m.month = ?
        GROUP BY p.status`,
    )
    .all(month) as Array<{ status: string; sum: number }>;
  return {
    month,
    target: targetFor(database, month),
    confirmed: rows.find((r) => r.status === "confirmed")?.sum ?? 0,
    pending: rows.find((r) => r.status === "pending")?.sum ?? 0,
  };
}

function monthsOf(database: DatabaseSync, paymentId: number): string[] {
  return (
    database
      .prepare("SELECT month FROM contribution_months WHERE payment_id = ? ORDER BY month")
      .all(paymentId) as Array<{ month: string }>
  ).map((r) => r.month);
}

function coveredMonths(database: DatabaseSync, userId: number): Set<string> {
  return new Set(
    (
      database
        .prepare("SELECT month FROM contribution_months WHERE user_id = ?")
        .all(userId) as Array<{ month: string }>
    ).map((r) => r.month),
  );
}

function countPending(database: DatabaseSync): number {
  return (
    database
      .prepare("SELECT COUNT(*) AS c FROM contribution_payments WHERE status = 'pending'")
      .get() as { c: number }
  ).c;
}

// Plata + lunile ei, într-o tranzacție: fără ea, o lună deja ocupată
// (UNIQUE) ar lăsa o plată fără luni.
function insertPayment(
  database: DatabaseSync,
  p: {
    userId: number;
    months: string[];
    perMonth: number;
    method: PaymentMethod;
    status: "pending" | "confirmed";
    note: string | null;
    decidedBy: string | null;
    addedByAdmin: boolean;
  },
): number {
  database.exec("BEGIN");
  try {
    const now = new Date().toISOString();
    const res = database
      .prepare(
        `INSERT INTO contribution_payments
           (user_id, months_count, per_month, total, method, status, note,
            declared_at, decided_at, decided_by, added_by_admin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        p.userId,
        p.months.length,
        p.perMonth,
        p.perMonth * p.months.length,
        p.method,
        p.status,
        p.note,
        now,
        p.status === "confirmed" ? now : null,
        p.decidedBy,
        p.addedByAdmin ? 1 : 0,
      );
    const id = Number(res.lastInsertRowid);
    const ins = database.prepare(
      "INSERT INTO contribution_months (payment_id, user_id, month, amount) VALUES (?, ?, ?, ?)",
    );
    for (const m of p.months) ins.run(id, p.userId, m, p.perMonth);
    database.exec("COMMIT");
    return id;
  } catch (e) {
    database.exec("ROLLBACK");
    throw e;
  }
}

function parseMethod(value: unknown, allowCash: boolean): PaymentMethod {
  if (value === "revolut" || value === "iban" || (allowCash && value === "cash")) return value;
  throw new Error("Metodă de plată necunoscută.");
}

async function logContribution(message: string, meta: Record<string, string | number | null>) {
  const { logActivity } = await import("../activity-log");
  await logActivity("contribution", message, meta, { skipPush: true });
}

// ---------------------------------------------------------------------------
// Utilizator
// ---------------------------------------------------------------------------

export const getMyContribution = createServerFn({ method: "GET" }).handler(
  async (): Promise<MyContribution> => {
    const { requireAuth } = await import("../auth/admin.server");
    const session = await requireAuth();
    const database = await db();
    const month = currentMonth();
    const progress = progressFor(database, month);

    const account = database
      .prepare("SELECT role, contribution_exempt FROM users WHERE id = ?")
      .get(session.data.userId!) as { role: string; contribution_exempt: number } | undefined;
    if (account?.role === "admin") {
      return { kind: "admin", progress, pendingCount: countPending(database) };
    }

    const userId = session.data.userId!;
    const rows = database
      .prepare(
        `SELECT m.month AS month, p.status AS status
           FROM contribution_months m JOIN contribution_payments p ON p.id = m.payment_id
          WHERE m.user_id = ?`,
      )
      .all(userId) as Array<{ month: string; status: string }>;
    const byMonth = new Map(rows.map((r) => [r.month, r.status]));

    const exempt = !!account?.contribution_exempt;
    const own = byMonth.get(month);
    const status: MonthStatus = exempt
      ? "exempt"
      : own === "confirmed"
        ? "confirmed"
        : own === "pending"
          ? "pending"
          : "unpaid";

    let coveredUntil: string | null = null;
    for (let m = month; byMonth.has(m); m = addMonths(m, 1)) coveredUntil = m;

    const pendingRows = database
      .prepare(
        `SELECT id, per_month, total, method, declared_at FROM contribution_payments
          WHERE user_id = ? AND status = 'pending' ORDER BY declared_at DESC`,
      )
      .all(userId) as Array<{
      id: number;
      per_month: number;
      total: number;
      method: PaymentMethod;
      declared_at: string;
    }>;

    return {
      kind: "user",
      exempt,
      status,
      coveredUntil,
      pendingPayments: pendingRows.map((r) => ({
        id: r.id,
        months: monthsOf(database, r.id),
        perMonth: r.per_month,
        total: r.total,
        method: r.method,
        declaredAt: r.declared_at,
      })),
      progress,
    };
  },
);

export const declareContribution = createServerFn({ method: "POST" })
  .validator((d: { months: number; perMonth: number; method: PaymentMethod }) => d)
  .handler(async ({ data }): Promise<{ ok: true; months: string[] }> => {
    const { requireAuth } = await import("../auth/admin.server");
    const session = await requireAuth();
    const err = validateDeclaration(data.months, data.perMonth);
    if (err) throw new Error(err);
    const method = parseMethod(data.method, false);

    const database = await db();
    const userId = session.data.userId!;
    const account = database
      .prepare("SELECT username, role, contribution_exempt FROM users WHERE id = ?")
      .get(userId) as { username: string; role: string; contribution_exempt: number } | undefined;
    if (!account || account.role === "admin") {
      throw new Error("Conturile de admin nu au contribuție.");
    }
    if (account.contribution_exempt) throw new Error("Contul tău e scutit de contribuție.");

    const months = allocateMonths(currentMonth(), data.months, coveredMonths(database, userId));
    insertPayment(database, {
      userId,
      months,
      perMonth: data.perMonth,
      method,
      status: "pending",
      note: null,
      decidedBy: null,
      addedByAdmin: false,
    });

    const total = data.perMonth * months.length;
    const { logActivity } = await import("../activity-log");
    await logActivity(
      "contribution",
      `${account.username} a declarat ${total} lei (${METHOD_LABELS[method]}) pentru ${monthsRangeLabel(months)}`,
      { username: account.username, total, method, months: months.join(",") },
      { tag: "contribution" },
    );
    return { ok: true, months };
  });

export const cancelMyContribution = createServerFn({ method: "POST" })
  .validator((d: { id: number }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { requireAuth } = await import("../auth/admin.server");
    const session = await requireAuth();
    const database = await db();
    const row = database
      .prepare("SELECT user_id, status FROM contribution_payments WHERE id = ?")
      .get(data.id) as { user_id: number; status: string } | undefined;
    if (!row || row.user_id !== session.data.userId) throw new Error("Plata nu există.");
    if (row.status !== "pending") throw new Error("Plata a fost deja confirmată de admin.");
    database.prepare("DELETE FROM contribution_months WHERE payment_id = ?").run(data.id);
    database.prepare("DELETE FROM contribution_payments WHERE id = ?").run(data.id);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

async function requireAdminSession() {
  const { requireAdmin } = await import("../auth/admin.server");
  return requireAdmin();
}

export const getContributionsOverview = createServerFn({ method: "GET" })
  .validator((d: { month?: string } | undefined) => ({ month: d?.month }))
  .handler(async ({ data }): Promise<ContributionsOverview> => {
    await requireAdminSession();
    const database = await db();
    const now = currentMonth();
    const month = data.month && isMonth(data.month) ? data.month : now;

    const users = database
      .prepare(
        `SELECT id, username, contribution_exempt FROM users
          WHERE role = 'user' AND status = 'approved'
          ORDER BY username COLLATE NOCASE`,
      )
      .all() as Array<{ id: number; username: string; contribution_exempt: number }>;
    const monthRows = database
      .prepare(
        `SELECT m.user_id AS user_id, m.amount AS amount, p.status AS status
           FROM contribution_months m JOIN contribution_payments p ON p.id = m.payment_id
          WHERE m.month = ?`,
      )
      .all(month) as Array<{ user_id: number; amount: number; status: string }>;
    const byUser = new Map(monthRows.map((r) => [r.user_id, r]));

    const contributors: ContributorRow[] = users.map((u) => {
      const r = byUser.get(u.id);
      const status: MonthStatus =
        r?.status === "confirmed"
          ? "confirmed"
          : r?.status === "pending"
            ? "pending"
            : u.contribution_exempt
              ? "exempt"
              : "unpaid";
      return {
        userId: u.id,
        username: u.username,
        exempt: !!u.contribution_exempt,
        status,
        amount: r?.amount ?? 0,
      };
    });

    const payments = database
      .prepare(
        `SELECT p.*, u.username AS username
           FROM contribution_payments p LEFT JOIN users u ON u.id = p.user_id
          ORDER BY p.declared_at DESC
          LIMIT 200`,
      )
      .all() as Array<{
      id: number;
      user_id: number;
      username: string | null;
      months_count: number;
      per_month: number;
      total: number;
      method: PaymentMethod;
      status: AdminPayment["status"];
      note: string | null;
      declared_at: string;
      decided_at: string | null;
      decided_by: string | null;
      added_by_admin: number;
    }>;
    const all: AdminPayment[] = payments.map((p) => ({
      id: p.id,
      userId: p.user_id,
      username: p.username ?? "(cont șters)",
      months: monthsOf(database, p.id),
      monthsCount: p.months_count,
      perMonth: p.per_month,
      total: p.total,
      method: p.method,
      status: p.status,
      note: p.note,
      declaredAt: p.declared_at,
      decidedAt: p.decided_at,
      decidedBy: p.decided_by,
      addedByAdmin: !!p.added_by_admin,
    }));

    return {
      month,
      currentMonth: now,
      progress: progressFor(database, month),
      currentTarget: targetFor(database, now),
      contributors,
      pending: all.filter((p) => p.status === "pending").reverse(),
      history: all.filter((p) => p.status !== "pending"),
    };
  });

function loadPayment(database: DatabaseSync, id: number) {
  const row = database
    .prepare(
      `SELECT p.status AS status, p.total AS total, u.username AS username
         FROM contribution_payments p LEFT JOIN users u ON u.id = p.user_id
        WHERE p.id = ?`,
    )
    .get(id) as { status: string; total: number; username: string | null } | undefined;
  if (!row) throw new Error("Plata nu există.");
  return row;
}

export const confirmContribution = createServerFn({ method: "POST" })
  .validator((d: { id: number }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const session = await requireAdminSession();
    const database = await db();
    const row = loadPayment(database, data.id);
    if (row.status !== "pending") throw new Error("Plata nu mai e în așteptare.");
    const by = session.data.username ?? "admin";
    database
      .prepare(
        "UPDATE contribution_payments SET status = 'confirmed', decided_at = ?, decided_by = ? WHERE id = ?",
      )
      .run(new Date().toISOString(), by, data.id);
    await logContribution(
      `Contribuție confirmată: ${row.username} — ${row.total} lei pentru ${monthsRangeLabel(monthsOf(database, data.id))} (de ${by})`,
      { username: row.username, total: row.total, by },
    );
    return { ok: true };
  });

export const rejectContribution = createServerFn({ method: "POST" })
  .validator((d: { id: number }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const session = await requireAdminSession();
    const database = await db();
    const row = loadPayment(database, data.id);
    if (row.status !== "pending") throw new Error("Plata nu mai e în așteptare.");
    const by = session.data.username ?? "admin";
    const months = monthsOf(database, data.id);
    // Lunile se eliberează, ca utilizatorul să poată declara din nou; în
    // istoric rămâne câte luni a acoperit plata respinsă (months_count).
    database.prepare("DELETE FROM contribution_months WHERE payment_id = ?").run(data.id);
    database
      .prepare(
        "UPDATE contribution_payments SET status = 'rejected', decided_at = ?, decided_by = ? WHERE id = ?",
      )
      .run(new Date().toISOString(), by, data.id);
    await logContribution(
      `Contribuție respinsă: ${row.username} — ${row.total} lei pentru ${monthsRangeLabel(months)} (de ${by})`,
      { username: row.username, total: row.total, by },
    );
    return { ok: true };
  });

export const deleteContribution = createServerFn({ method: "POST" })
  .validator((d: { id: number }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const session = await requireAdminSession();
    const database = await db();
    const row = loadPayment(database, data.id);
    const by = session.data.username ?? "admin";
    const months = monthsOf(database, data.id);
    database.prepare("DELETE FROM contribution_months WHERE payment_id = ?").run(data.id);
    database.prepare("DELETE FROM contribution_payments WHERE id = ?").run(data.id);
    await logContribution(
      `Contribuție ștearsă: ${row.username} — ${row.total} lei${months.length ? ` pentru ${monthsRangeLabel(months)}` : ""} (de ${by})`,
      { username: row.username, total: row.total, by },
    );
    return { ok: true };
  });

export const addManualContribution = createServerFn({ method: "POST" })
  .validator(
    (d: {
      userId: number;
      startMonth: string;
      months: number;
      perMonth: number;
      method: PaymentMethod;
      note?: string | null;
    }) => d,
  )
  .handler(async ({ data }): Promise<{ ok: true; months: string[] }> => {
    const session = await requireAdminSession();
    const err = validateDeclaration(data.months, data.perMonth);
    if (err) throw new Error(err);
    if (!isMonth(data.startMonth)) throw new Error("Luna de start e invalidă.");
    const method = parseMethod(data.method, true);

    const database = await db();
    const user = database
      .prepare("SELECT username FROM users WHERE id = ? AND role = 'user'")
      .get(data.userId) as { username: string } | undefined;
    if (!user) throw new Error("Utilizatorul nu există.");

    const by = session.data.username ?? "admin";
    const months = allocateMonths(
      data.startMonth,
      data.months,
      coveredMonths(database, data.userId),
    );
    insertPayment(database, {
      userId: data.userId,
      months,
      perMonth: data.perMonth,
      method,
      status: "confirmed",
      note: data.note?.trim() || null,
      decidedBy: by,
      addedByAdmin: true,
    });
    const total = data.perMonth * months.length;
    await logContribution(
      `Plată adăugată de ${by}: ${user.username} — ${total} lei (${METHOD_LABELS[method]}) pentru ${monthsRangeLabel(months)}`,
      { username: user.username, total, method, by },
    );
    return { ok: true, months };
  });

export const setContributionTarget = createServerFn({ method: "POST" })
  .validator((d: { target: number }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const session = await requireAdminSession();
    if (!Number.isInteger(data.target) || data.target < 1 || data.target > 100_000) {
      throw new Error("Ținta trebuie să fie o sumă întreagă, pozitivă.");
    }
    const database = await db();
    const month = currentMonth();
    database
      .prepare(
        "INSERT INTO contribution_targets (month, target) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET target = excluded.target",
      )
      .run(month, data.target);
    // Țintele programate după luna curentă (n-ar trebui să existe, dar dacă
    // ar exista) ar anula schimbarea de acum — le scoatem.
    database.prepare("DELETE FROM contribution_targets WHERE month > ?").run(month);
    const by = session.data.username ?? "admin";
    await logContribution(`Ținta lunară schimbată la ${data.target} lei (de ${by})`, {
      target: data.target,
      by,
    });
    return { ok: true };
  });

export const setContributionExempt = createServerFn({ method: "POST" })
  .validator((d: { userId: number; exempt: boolean }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const session = await requireAdminSession();
    const database = await db();
    const user = database
      .prepare("SELECT username FROM users WHERE id = ? AND role = 'user'")
      .get(data.userId) as { username: string } | undefined;
    if (!user) throw new Error("Utilizatorul nu există.");
    database
      .prepare("UPDATE users SET contribution_exempt = ? WHERE id = ?")
      .run(data.exempt ? 1 : 0, data.userId);
    const by = session.data.username ?? "admin";
    await logContribution(
      `${user.username} ${data.exempt ? "scutit de" : "nu mai e scutit de"} contribuție (de ${by})`,
      { username: user.username, by },
    );
    return { ok: true };
  });
