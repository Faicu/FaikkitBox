export default function () {
  const INTERVAL_MS = 60_000; // 1 minut

  // SHA-urile cunoscute la prima rulare — folosite ca baseline, fără notificări
  let knownShas: Set<string> | null = null;

  async function poll() {
    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;
    if (!repo) return;

    try {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=10`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return;

      const raw: any[] = await res.json();
      if (!Array.isArray(raw)) return;

      const { getDb } = await import("../../src/lib/db");
      const db = getDb();

      if (knownShas === null) {
        // Prima rulare — salvăm baseline fără notificări
        knownShas = new Set(raw.map((c) => String(c.sha ?? "")));
        // Upsert în DB pentru sincronizare
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
        return;
      }

      // Polling normal — notificăm doar commit-urile noi față de baseline
      const { sendPushToAll } = await import("../../src/lib/push");
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO commits (sha, short_sha, message, author, date, url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const now = new Date().toISOString();

      for (const c of raw) {
        const sha = String(c.sha ?? "");
        if (!sha || knownShas.has(sha)) continue;

        knownShas.add(sha);

        const message = String(c.commit?.message ?? "").split("\n")[0];
        const author = c.commit?.author?.name ?? c.author?.login ?? "necunoscut";
        const date = c.commit?.author?.date ?? now;

        stmt.run(sha, sha.slice(0, 7), message, author, date,
          c.html_url ?? `https://github.com/${repo}/commit/${sha}`, now);

        await sendPushToAll(`📦 Commit nou — ${author}`, message).catch(() => {});
      }
    } catch {
      // GitHub poate fi inaccesibil — ignorăm
    }
  }

  const t1 = setTimeout(poll, 10_000);
  const t2 = setInterval(poll, INTERVAL_MS);
  process.on("exit", () => { clearTimeout(t1); clearInterval(t2); });
}
