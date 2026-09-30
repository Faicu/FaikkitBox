// ---------------------------------------------------------------------------
// Jurnalul aplicației VW Welcome (navigația Teyes din mașină). Aplicația
// trimite liniile de diagnostic prin POST /api/vw-log (server/routes/api/vw-log.ts);
// pagina /vw le afișează. Server-only: importă node:sqlite prin getDb.
// ---------------------------------------------------------------------------

import { getDb } from "../db";

export interface VwLogEntry {
  id: number;
  deviceAt: string; // ora de pe navigație (poate fi greșită după un boot la rece, fără GPS)
  receivedAt: string;
  version: string | null;
  line: string;
}

export interface VwIncomingLine {
  t: number; // epoch ms, ceasul navigației
  text: string;
}

const MAX_LINE_LEN = 1000;
// Sonda CAN a aplicației trimite mii de linii pe drum; păstrăm mult, dar nu la nesfârșit.
const MAX_ROWS = 200_000;
export const MAX_LINES_PER_REQUEST = 200;

/** Inserează un lot; întoarce câte linii noi au intrat (duplicatele se ignoră). */
export function insertVwLines(lines: VwIncomingLine[], version: string | null): number {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO vw_log (device_at, received_at, version, line) VALUES (?, ?, ?, ?)`,
  );
  let added = 0;
  db.exec("BEGIN");
  try {
    for (const l of lines) {
      if (!Number.isFinite(l.t) || typeof l.text !== "string") continue;
      const deviceAt = new Date(l.t).toISOString();
      const r = stmt.run(deviceAt, now, version, l.text.slice(0, MAX_LINE_LEN));
      added += Number(r.changes);
    }
    // Păstrăm doar ultimele MAX_ROWS linii primite.
    db.prepare(
      `DELETE FROM vw_log WHERE id <= (SELECT id FROM vw_log ORDER BY id DESC LIMIT 1 OFFSET ?)`,
    ).run(MAX_ROWS);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return added;
}

/** `eventsOnly` ascunde liniile de diagnostic („DIAG …”) și ale sondei CAN („CAN …”). */
export function readVwLog(eventsOnly: boolean, limit = 1000): VwLogEntry[] {
  const filter = eventsOnly ? `WHERE line NOT LIKE 'DIAG %' AND line NOT LIKE 'CAN %'` : "";
  const rows = getDb()
    .prepare(
      `SELECT id, device_at, received_at, version, line FROM vw_log ${filter}
       ORDER BY device_at DESC, id DESC LIMIT ?`,
    )
    .all(limit) as Array<{
    id: number;
    device_at: string;
    received_at: string;
    version: string | null;
    line: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    deviceAt: r.device_at,
    receivedAt: r.received_at,
    version: r.version,
    line: r.line,
  }));
}

export function clearVwLogCore(): void {
  getDb().exec("DELETE FROM vw_log");
}
