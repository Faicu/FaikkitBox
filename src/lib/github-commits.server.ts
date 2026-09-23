// Sincronizarea commit-urilor din GitHub în tabela `commits` — un singur loc,
// folosit și de polling-ul din pagina Tehnic (getRecentCommits), și de
// plugin-ul care sincronizează la pornire (github-commit-tracker).
//
// Doar import dinamic din module care ajung în client (vezi github.functions.ts).

import type { GitHubCommit } from "./github.functions";

const PER_PAGE = 100;
// Plafon de siguranță: 1000 de commit-uri într-o singură sincronizare. Se
// atinge doar dacă DB-ul e gol sau n-are niciunul din istoricul recent.
const MAX_PAGES = 10;

function githubRepo(): string {
  return process.env.GITHUB_REPO ?? "Faicu/FaikkitBox";
}

function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "faikkitbox-dashboard",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) h["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

interface GitHubApiListCommit {
  sha?: string;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string };
    committer?: { date?: string };
  };
  author?: { login?: string };
  html_url?: string;
}

function toCommit(c: GitHubApiListCommit, repo: string): GitHubCommit {
  const sha = String(c.sha ?? "");
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message: String(c.commit?.message ?? "").split("\n")[0],
    author: c.commit?.author?.name ?? c.author?.login ?? "necunoscut",
    date: c.commit?.author?.date ?? c.commit?.committer?.date ?? new Date().toISOString(),
    url: c.html_url ?? `https://github.com/${repo}/commit/${sha}`,
  };
}

// Merge înapoi pe pagini până dă de un commit deja salvat. Cu o singură pagină
// de 20 (cum era înainte), un push de peste 20 de commit-uri pierdea definitiv
// pe cele mai vechi — webhook-ul poate pica, iar polling-ul nu le mai vedea.
//
// Commit-urile noi primesc o singură notificare pentru tot lotul, indiferent
// care sursă (webhook, pornire, polling) le descoperă prima — INSERT OR IGNORE
// spune exact care sunt noi.
export async function syncCommitsFromGitHub(): Promise<GitHubCommit[]> {
  const repo = githubRepo();
  const { getDb } = await import("./db");
  const db = getDb();
  const known = db.prepare("SELECT 1 FROM commits WHERE sha = ?");

  const fetched: GitHubCommit[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/commits?per_page=${PER_PAGE}&page=${page}`,
      { headers: githubHeaders(), signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) throw new Error(`GitHub API a răspuns ${res.status}`);
    const raw: GitHubApiListCommit[] = await res.json();
    if (!Array.isArray(raw)) throw new Error("Răspuns neașteptat de la GitHub API");

    const commits = raw.filter((c) => c.sha).map((c) => toCommit(c, repo));
    fetched.push(...commits);
    if (commits.length < PER_PAGE || commits.some((c) => known.get(c.sha))) break;
  }

  const { notifyGithubCommits } = await import("./notifications/notifications");
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO commits (sha, short_sha, message, author, date, url, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const fresh: Array<{ author: string; message: string }> = [];
  for (const c of fetched) {
    const result = stmt.run(c.sha, c.shortSha, c.message, c.author, c.date, c.url, now);
    if (result.changes > 0) fresh.push({ author: c.author, message: c.message });
  }
  if (fresh.length > 0) {
    console.log(`[github] ${fresh.length} commit-uri noi sincronizate`);
    await notifyGithubCommits(fresh).catch((err) => {
      console.warn("[github] Trimitere push eșuată:", err);
    });
  }
  return fetched;
}
