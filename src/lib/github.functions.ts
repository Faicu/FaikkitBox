import { createServerFn } from "@tanstack/react-start";

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

      return { status: "ok", commits };
    } catch (e) {
      return { status: "error", error: e instanceof Error ? e.message : String(e), commits: [] };
    }
  },
);

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
        sha: data.sha,
        shortSha: data.sha.slice(0, 7),
        message: "", author: "", date: "", url: "",
        filesChanged: 0, additions: 0, deletions: 0, files: [],
      };
    }
  });
