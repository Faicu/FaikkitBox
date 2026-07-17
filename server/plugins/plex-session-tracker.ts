export default function () {
  const INTERVAL_MS = 30_000;

  async function poll() {
    const token = process.env.PLEX_TOKEN;
    const base = process.env.PLEX_URL?.replace(/\/$/, "");
    if (!token || !base) return;

    try {
      const { trackPlexSessions } = await import("../../src/lib/activity-log");

      const headers: Record<string, string> = {
        Accept: "application/json",
        "X-Plex-Token": token,
      };

      const res = await fetch(`${base}/status/sessions`, { headers });
      if (!res.ok) return;

      const json = await res.json();
      const sessionsMd: any[] = json?.MediaContainer?.Metadata ?? [];

      await trackPlexSessions(
        sessionsMd.map((s: any) => ({
          user: s.User?.title ?? "unknown",
          title: s.title ?? "",
          grandparentTitle: s.grandparentTitle || undefined,
          player: s.Player?.title || undefined,
        })),
      );
    } catch {
      // Plex poate fi offline — ignorăm
    }
  }

  setInterval(poll, INTERVAL_MS);
}
