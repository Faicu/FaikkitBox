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
