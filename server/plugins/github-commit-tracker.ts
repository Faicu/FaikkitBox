// Polling GitHub dezactivat — notificările vin acum via webhook (POST /api/github-webhook)
// Fișierul e păstrat pentru a nu pierde istoricul de commits la prima pornire.

export default function () {
  async function syncOnStart() {
    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;
    if (!repo) return;

    try {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=20`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return;

      const raw: any[] = await res.json();
      if (!Array.isArray(raw)) return;

      const { getDb } = await import("../../src/lib/db");
      const db = getDb();
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO commits (sha, short_sha, message, author, date, url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const now = new Date().toISOString();
      for (const c of raw) {
        const sha = String(c.sha ?? "");
        if (!sha) continue;
        stmt.run(
          sha, sha.slice(0, 7),
          String(c.commit?.message ?? "").split("\n")[0],
          c.commit?.author?.name ?? c.author?.login ?? "necunoscut",
          c.commit?.author?.date ?? now,
          c.html_url ?? `https://github.com/${repo}/commit/${sha}`,
          now,
        );
      }
    } catch {
      // GitHub poate fi inaccesibil la pornire — ignorăm
    }
  }

  // Sincronizare unică la pornirea serverului (populate DB, fără notificări)
  setTimeout(syncOnStart, 5_000);
}
