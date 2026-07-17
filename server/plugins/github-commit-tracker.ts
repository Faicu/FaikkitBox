export default function () {
  const INTERVAL_MS = 60_000; // 1 minut

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

      for (const c of raw) {
        const sha = String(c.sha ?? "");
        if (!sha) continue;

        const existing = db.prepare("SELECT sha FROM commits WHERE sha = ?").get(sha);
        if (existing) continue;

        // Commit nou — upsert + push
        const message = String(c.commit?.message ?? "").split("\n")[0];
        const author = c.commit?.author?.name ?? c.author?.login ?? "necunoscut";
        const date = c.commit?.author?.date ?? c.commit?.committer?.date ?? new Date().toISOString();
        const url = c.html_url ?? `https://github.com/${repo}/commit/${sha}`;
        const shortSha = sha.slice(0, 7);

        db.prepare(
          `INSERT OR IGNORE INTO commits (sha, short_sha, message, author, date, url, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(sha, shortSha, message, author, date, url, new Date().toISOString());

        const { sendPushToAll } = await import("../../src/lib/push");
        await sendPushToAll(`📦 Commit nou — ${author}`, message).catch(() => {});
      }
    } catch {
      // GitHub poate fi inaccesibil — ignorăm
    }
  }

  // Prima verificare după 10 secunde (să dăm timp serverului să pornească)
  setTimeout(poll, 10_000);
  setInterval(poll, INTERVAL_MS);
}
