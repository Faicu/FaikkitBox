import { createServerFn } from "@tanstack/react-start";
import { execSync } from "child_process";

export interface GitHubCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface GitHubCommitsResult {
  status: "ok" | "error";
  error?: string;
  commits: GitHubCommit[];
}

export interface GitHubCommitFile {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed" | string;
  additions: number;
  deletions: number;
}

export interface GitHubCommitDetail {
  status: "ok" | "error";
  error?: string;
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  url: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  files: GitHubCommitFile[];
}

const GITHUB_REPO = process.env.GITHUB_REPO ?? "Faicu/FaikkitBox";

function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "faikkitbox-dashboard",
  };
  if (process.env.GITHUB_TOKEN) h["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function upsertCommits(commits: GitHubCommit[]): Promise<void> {
  try {
    const { getDb } = await import("./db");
    const db = getDb();
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO commits (sha, short_sha, message, author, date, url, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const now = new Date().toISOString();
    for (const c of commits) {
      stmt.run(c.sha, c.shortSha, c.message, c.author, c.date, c.url, now);
    }
  } catch (e) {
    console.warn("[github] Upsert commits eșuat:", e);
  }
}

// Fetch GitHub + upsert în DB (rulat periodic din React Query)
export const getRecentCommits = createServerFn({ method: "GET" }).handler(
  async (): Promise<GitHubCommitsResult> => {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/commits?per_page=20`,
        { headers: githubHeaders(), signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) throw new Error(`GitHub API a răspuns ${res.status}`);
      const raw: any[] = await res.json();
      if (!Array.isArray(raw)) throw new Error("Răspuns neașteptat de la GitHub API");

      const commits: GitHubCommit[] = raw.map((c) => ({
        sha: String(c.sha ?? ""),
        shortSha: String(c.sha ?? "").slice(0, 7),
        message: String(c.commit?.message ?? "").split("\n")[0],
        author: c.commit?.author?.name ?? c.author?.login ?? "necunoscut",
        date: c.commit?.author?.date ?? c.commit?.committer?.date ?? "",
        url: c.html_url ?? `https://github.com/${GITHUB_REPO}/commit/${c.sha}`,
      }));

      // Salvează în DB — acumulează istoric nelimitat
      await upsertCommits(commits);

      return { status: "ok", commits };
    } catch (e) {
      return { status: "error", error: e instanceof Error ? e.message : String(e), commits: [] };
    }
  },
);

// Citește commits din DB — sursa principală pentru timeline
export const getCommitsFromDb = createServerFn({ method: "GET" }).handler(
  async (): Promise<GitHubCommitsResult> => {
    try {
      const { getDb } = await import("./db");
      const db = getDb();
      const rows = db.prepare(
        `SELECT sha, short_sha, message, author, date, url
         FROM commits ORDER BY date DESC LIMIT 500`
      ).all() as Array<{ sha: string; short_sha: string; message: string; author: string; date: string; url: string }>;

      const commits: GitHubCommit[] = rows.map((r) => ({
        sha: r.sha,
        shortSha: r.short_sha,
        message: r.message,
        author: r.author,
        date: r.date,
        url: r.url,
      }));

      return { status: "ok", commits };
    } catch (e) {
      return { status: "error", error: e instanceof Error ? e.message : String(e), commits: [] };
    }
  },
);

// Detalii complete pentru un commit — live de pe GitHub, la cerere
export const getCommitDetail = createServerFn({ method: "GET" })
  .validator((data: { sha: string }) => data)
  .handler(async ({ data }): Promise<GitHubCommitDetail> => {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/commits/${data.sha}`,
        { headers: githubHeaders(), signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) throw new Error(`GitHub API a răspuns ${res.status}`);
      const c: any = await res.json();

      return {
        status: "ok",
        sha: String(c.sha ?? ""),
        shortSha: String(c.sha ?? "").slice(0, 7),
        message: String(c.commit?.message ?? ""),
        author: c.commit?.author?.name ?? c.author?.login ?? "necunoscut",
        date: c.commit?.author?.date ?? c.commit?.committer?.date ?? "",
        url: c.html_url ?? "",
        filesChanged: c.files?.length ?? 0,
        additions: c.stats?.additions ?? 0,
        deletions: c.stats?.deletions ?? 0,
        files: (c.files ?? []).map((f: any) => ({
          filename: String(f.filename ?? ""),
          status: String(f.status ?? "modified"),
          additions: Number(f.additions ?? 0),
          deletions: Number(f.deletions ?? 0),
        })),
      };
    } catch (e) {
      return {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
        sha: data.sha, shortSha: data.sha.slice(0, 7),
        message: "", author: "", date: "", url: "",
        filesChanged: 0, additions: 0, deletions: 0, files: [],
      };
    }
  });

export interface GitHubSyncStatus {
  deployedSha: string;
  deployedShortSha: string;
  latestSha: string;
  latestShortSha: string;
  isSynced: boolean;
  commitsBehind: number;
}

export const getDeployedSha = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ sha: string }> => {
    try {
      const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
      return { sha };
    } catch {
      return { sha: "" };
    }
  },
);

export const getGitHubSyncStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ status: "ok"; data: GitHubSyncStatus } | { status: "error"; error: string }> => {
    try {
      const deployedSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/commits?per_page=30`,
        { headers: githubHeaders(), signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const commits: any[] = await res.json();

      const latestSha = String(commits[0]?.sha ?? "");
      const idx = commits.findIndex((c) => c.sha === deployedSha);
      const commitsBehind = idx === -1 ? (latestSha !== deployedSha ? 1 : 0) : idx;

      return {
        status: "ok",
        data: {
          deployedSha,
          deployedShortSha: deployedSha.slice(0, 7),
          latestSha,
          latestShortSha: latestSha.slice(0, 7),
          isSynced: deployedSha === latestSha,
          commitsBehind,
        },
      };
    } catch (e) {
      return { status: "error", error: e instanceof Error ? e.message : String(e) };
    }
  },
);
