// ---------------------------------------------------------------------------
// Verificarea zilnică a actualizărilor: Plex, Immich, Ubuntu (pachete și
// cererea de repornire). qBittorrent nu intră — nu se actualizează niciodată
// din aplicație. Rulată de server/plugins/service-jobs.ts.
//
// Reamintire zilnică, nu doar la noutăți (decizia userului, 26 sept. 2026):
// cât timp ceva rămâne neinstalat, fiecare verificare îl anunță din nou —
// o intrare în jurnal și un push, cu tot ce e disponibil. Fără nimic de
// anunțat, nu se scrie nimic.
// ---------------------------------------------------------------------------

import { getDb } from "../db";
import type { ServiceVersion } from "./versions";

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const shortVersion = (v?: string) => (v ?? "?").replace(/^v/i, "").split(/[-+ ]/)[0];

export interface UpdateSummary {
  items: string[];
  // Unde duce apăsarea notificării: pagina serviciului, sau Sistem la mai
  // multe servicii (Plex n-are pagină proprie — cardul lui e în Tehnic).
  url: string;
}

export function summarizeUpdates(v: {
  plex?: ServiceVersion;
  immich?: ServiceVersion;
  ubuntu?: ServiceVersion;
}): UpdateSummary {
  const items: string[] = [];
  const pages = new Set<string>();
  if (v.plex?.upToDate === false) {
    items.push(`Plex ${shortVersion(v.plex.current)} → ${shortVersion(v.plex.latest)}`);
    pages.add("/tehnic");
  }
  if (v.immich?.upToDate === false) {
    items.push(`Immich ${shortVersion(v.immich.current)} → ${shortVersion(v.immich.latest)}`);
    pages.add("/immich");
  }
  const pending = v.ubuntu?.pending ?? 0;
  if (pending > 0) {
    items.push(`Ubuntu: ${pending} ${pending === 1 ? "pachet" : "pachete"}`);
    pages.add("/sistem");
  }
  if (v.ubuntu?.rebootRequired) {
    items.push("Ubuntu cere repornire");
    pages.add("/sistem");
  }
  return { items, url: pages.size === 1 ? [...pages][0] : "/sistem" };
}

// `now` și `readVersions` sunt parametri doar pentru teste.
export async function checkForUpdates(
  opts: {
    now?: number;
    readVersions?: () => Promise<{
      plex: ServiceVersion;
      immich: ServiceVersion;
      ubuntu: ServiceVersion;
    }>;
  } = {},
): Promise<"skipped" | "nothing" | "notified" | "failed"> {
  const now = opts.now ?? Date.now();
  const db = getDb();
  const last = db.prepare("SELECT checked_at FROM update_check WHERE id = 1").get() as
    { checked_at: string } | undefined;
  if (last && now - new Date(last.checked_at).getTime() < CHECK_INTERVAL_MS) return "skipped";

  const read = opts.readVersions ?? (await import("./versions")).readAllVersions;
  const v = await read();
  // Toate trei căzute (fără rețea, de exemplu): nu marcăm verificarea —
  // se reîncearcă la următoarea oră, nu abia mâine.
  if (v.plex.error && v.immich.error && v.ubuntu.error) return "failed";

  db.prepare(
    "INSERT INTO update_check (id, checked_at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET checked_at = excluded.checked_at",
  ).run(new Date(now).toISOString());

  const summary = summarizeUpdates(v);
  if (summary.items.length === 0) return "nothing";
  const { logActivity } = await import("../activity-log");
  await logActivity(
    "update_available",
    `Actualizări disponibile: ${summary.items.join(" · ")}`,
    { items: summary.items.join(" · ") },
    { url: summary.url },
  );
  return "notified";
}
