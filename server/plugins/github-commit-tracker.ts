// La pornirea serverului: sincronizează ultimele commits din GitHub și trimite
// notificări push pentru orice commit nou față de ce avem în DB.
// Acoperă cazul în care webhook-ul a picat în timpul unui restart.

export default function () {
  setTimeout(syncOnStart, 6_000);
}

async function syncOnStart() {
  const repo = process.env.GITHUB_REPO ?? "Faicu/FaikkitBox";
  const token = process.env.GITHUB_TOKEN;

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

    type GithubCommit = {
      sha?: string;
      commit?: { message?: string; author?: { name?: string; date?: string } };
      author?: { login?: string };
      html_url?: string;
    };
    const raw: GithubCommit[] = await res.json();
    if (!Array.isArray(raw)) return;

    const { getDb } = await import("../../src/lib/db");
    const { sendPushToAll } = await import("../../src/lib/push");

    const db = getDb();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO commits (sha, short_sha, message, author, date, url, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();

    for (const c of raw) {
      const sha = String(c.sha ?? "");
      if (!sha) continue;

      const message = String(c.commit?.message ?? "").split("\n")[0];
      const author = c.commit?.author?.name ?? c.author?.login ?? "necunoscut";
      const date = c.commit?.author?.date ?? now;
      const url = c.html_url ?? `https://github.com/${repo}/commit/${sha}`;

      // INSERT OR IGNORE returnează changes=0 dacă sha există deja
      const result = stmt.run(sha, sha.slice(0, 7), message, author, date, url, now);

      // Dacă e un commit nou (nu era în DB), trimite notificare push
      if (result.changes > 0) {
        await sendPushToAll(`📦 Commit nou — ${author}`, message).catch(() => {});
      }
    }
  } catch {
    // GitHub indisponibil la pornire — ignorăm silențios
  }
}
