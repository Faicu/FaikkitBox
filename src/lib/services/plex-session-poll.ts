// Sesiunile Plex active — sarcina „plex-sessions” din Watcher: începutul și
// sfârșitul vizionărilor în jurnal (trackPlexSessions) și HDR-ul dispozitivelor
// (recordDeviceSessions). Nu trebuie rulată în paralel cu ea însăși — ar scrie
// de două ori „a început să vizioneze”; garda e a Watcher-ului.

import type { PlexMetadataItem } from "./plex-shared";

// Un Plex blocat (în timpul unui update) ar ține altfel cererea minute întregi.
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

    // Separat de jurnal: o eroare aici nu oprește urmărirea vizionărilor.
    await recordDeviceSessions(sessionsMd as PlexMetadataItem[]).catch(() => {});

    await trackPlexSessions(
      sessionsMd.map((s) => {
        const dur = Number(s.duration ?? 0);
        // viewOffset vine mereu în ms. O conversie veche înmulțea cu 1000
        // offset-urile sub 1000, deci o redare abia pornită apărea cu 8 minute
        // de progres în „Vizionări recente”.
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
    // Plex offline: sesiunile rămân cum erau, iar eroarea nu se raportează —
    // la 10s ar umple istoricul cât Plex e oprit.
  }
}
