// ---------------------------------------------------------------------------
// Sesiunile Plex active — sarcina „plex-sessions” din Watcher, la 10s:
// începutul și sfârșitul fiecărei vizionări, în jurnal (trackPlexSessions din
// activity-log.ts), plus ce se vede despre HDR-ul dispozitivelor
// (recordDeviceSessions). Garda de suprapunere e a Watcher-ului: două
// verificări care primesc aceeași sesiune nouă ar vedea-o amândouă ca
// necunoscută și ar scrie de două ori „a început să vizioneze”, cu două
// notificări push.
// ---------------------------------------------------------------------------

import type { PlexMetadataItem } from "./plex-shared";

// Mult sub interval: un Plex blocat (în timpul unui update, de exemplu) ar ține
// altfel cererea minute întregi.
const REQUEST_TIMEOUT_MS = 10_000;

export async function pollPlexSessions(): Promise<void> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL?.replace(/\/$/, "");
  if (!token || !base) return;

  try {
    const { trackPlexSessions } = await import("../activity-log");
    const { recordDeviceSessions } = await import("./device-hdr.server");

    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Plex-Token": token,
    };

    const res = await fetch(`${base}/status/sessions`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return;

    const json = (await res.json()) as {
      MediaContainer?: {
        Metadata?: Array<{
          duration?: number;
          viewOffset?: number;
          title?: string;
          grandparentTitle?: string;
          ratingKey?: string;
          User?: { title?: string };
          Player?: { title?: string };
        }>;
      };
    };
    const sessionsMd = json?.MediaContainer?.Metadata ?? [];

    // Separat de jurnal: o eroare aici nu trebuie să oprească urmărirea
    // vizionărilor (și invers).
    await recordDeviceSessions(sessionsMd as PlexMetadataItem[]).catch(() => {});

    await trackPlexSessions(
      sessionsMd.map((s) => {
        const dur = Number(s.duration ?? 0);
        // viewOffset de la Plex e mereu în milisecunde. Aici exista o
        // conversie care înmulțea cu 1000 orice offset sub 1000, presupunând
        // secunde — dar asta lovea exact cazul legitim al unei redări abia
        // pornite: 500 ms (o jumătate de secundă) devenea 500 000 ms, adică
        // 8 minute. Peste pragul MIN_PROGRESS_MS din activity-log.ts, deci o
        // vizionare pornită și oprită imediat scria în "Vizionări recente" o
        // intrare falsă, cu progres inventat.
        const off = Number(s.viewOffset ?? 0);
        return {
          user: s.User?.title ?? "unknown",
          title: s.title ?? "",
          grandparentTitle: s.grandparentTitle || undefined,
          ratingKey: s.ratingKey || undefined,
          player: s.Player?.title || undefined,
          viewOffsetMs: off,
          durationMs: dur,
        };
      }),
    );
  } catch {
    // Plex poate fi offline (sau n-a răspuns la timp) — sesiunile rămân
    // cum erau, nu le închidem pe baza unei erori. Nici nu o raportăm ca
    // eroare a sarcinii: din 10 în 10 secunde, cât Plex e oprit, ar umple
    // istoricul și „Erori aplicație” cu același lucru.
  }
}
