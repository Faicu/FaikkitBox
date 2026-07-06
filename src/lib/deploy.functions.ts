import { createServerFn } from "@tanstack/react-start";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DeployStatus {
  status: "ok" | "error";
  error?: string;
  branch?: string;
  localSha?: string;
  localShortSha?: string;
  localMessage?: string;
  localDate?: string;
  remoteSha?: string;
  remoteShortSha?: string;
  remoteMessage?: string;
  remoteDate?: string;
  upToDate?: boolean;
}

const REPO_DIR = process.env.FAIKKITBOX_REPO_DIR ?? "/opt/faikkitbox";
const GITHUB_REPO = process.env.GITHUB_REPO ?? "Faicu/FaikkitBox";

export interface GitCommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface RecentCommitsResult {
  status: "ok" | "error";
  error?: string;
  commits: GitCommitInfo[];
}

export const getRecentCommits = createServerFn({ method: "GET" }).handler(async (): Promise<RecentCommitsResult> => {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits?per_page=5`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "faikkitbox-dashboard" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`GitHub API a raspuns ${res.status}`);
    const raw: any[] = await res.json();
    if (!Array.isArray(raw)) throw new Error("Raspuns neasteptat de la GitHub API");

    const commits: GitCommitInfo[] = raw.map((c) => ({
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
});

export const getDeployStatus = createServerFn({ method: "GET" }).handler(async (): Promise<DeployStatus> => {
  try {
    const { stdout: branchOut } = await execFileAsync("git", ["-C", REPO_DIR, "rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = branchOut.trim();

    const { stdout: localOut } = await execFileAsync("git", [
      "-C",
      REPO_DIR,
      "log",
      "-1",
      "--format=%H%n%h%n%s%n%cI",
    ]);
    const [localSha, localShortSha, localMessage, localDate] = localOut.trim().split("\n");

    // Repo public - nu e nevoie de token pentru citire (rate limit 60/ora fara autentificare,
    // suficient pentru un refresh la cateva minute).
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/${branch}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "faikkitbox-dashboard" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`GitHub API a raspuns ${res.status}`);
    const remote: any = await res.json();

    const remoteSha: string = remote.sha;
    const remoteShortSha = remoteSha.slice(0, 7);
    const remoteMessage: string = (remote.commit?.message ?? "").split("\n")[0];
    const remoteDate: string = remote.commit?.author?.date ?? remote.commit?.committer?.date ?? "";

    return {
      status: "ok",
      branch,
      localSha,
      localShortSha,
      localMessage,
      localDate,
      remoteSha,
      remoteShortSha,
      remoteMessage,
      remoteDate,
      upToDate: localSha === remoteSha,
    };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
});
