import { createServerFn } from "@tanstack/react-start";
import { execFile } from "child_process";
import { promisify } from "util";

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
  // Doar din getCommitsFromDb: totalul din DB (lista e plafonată la 500).
  total?: number;
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

interface GitHubApiCommit {
  sha?: string;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string };
    committer?: { date?: string };
  };
  author?: { login?: string };
  html_url?: string;
  stats?: { additions?: number; deletions?: number };
  files?: Array<{ filename?: string; status?: string; additions?: number; deletions?: number }>;
}

const GITHUB_REPO = process.env.GITHUB_REPO ?? "Faicu/FaikkitBox";

// Un SHA e hex, atât. Validarea NU e cosmetică: `data.sha` ajunge argument
// pentru `git show` — fără shell, deci fără injecție de shell, dar cu injecție
// de ARGUMENT: `--output=<fișier>` scrie în orice cale (verificat: chiar
// creează fișierul), cu drepturile serviciului, pornind de la o sesiune de admin.
const SHA_RE = /^[0-9a-f]{7,40}$/i;

function assertValidSha(sha: string): string {
  if (!SHA_RE.test(sha)) throw new Error("SHA invalid");
  return sha;
}

function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "faikkitbox-dashboard",
  };
  if (process.env.GITHUB_TOKEN) h["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

// GitHub → DB (rulat periodic de React Query).
export const getRecentCommits = createServerFn({ method: "GET" }).handler(
  async (): Promise<GitHubCommitsResult> => {
    const { requireAdmin } = await import("./auth/admin.server");
    await requireAdmin();
    try {
      // Salvează în DB — acumulează istoric nelimitat (vezi github-commits.server).
      const { syncCommitsFromGitHub } = await import("./github-commits.server");
      const commits = await syncCommitsFromGitHub();

      return { status: "ok", commits };
    } catch (e) {
      return { status: "error", error: e instanceof Error ? e.message : String(e), commits: [] };
    }
  },
);

// Commit-urile din DB — sursa timeline-ului.
export const getCommitsFromDb = createServerFn({ method: "GET" }).handler(
  async (): Promise<GitHubCommitsResult> => {
    const { requireAdmin } = await import("./auth/admin.server");
    await requireAdmin();
    try {
      const { getDb } = await import("./db");
      const db = getDb();
      const rows = db
        .prepare(
          `SELECT sha, short_sha, message, author, date, url
         FROM commits ORDER BY date DESC LIMIT 500`,
        )
        .all() as Array<{
        sha: string;
        short_sha: string;
        message: string;
        author: string;
        date: string;
        url: string;
      }>;

      const commits: GitHubCommit[] = rows.map((r) => ({
        sha: r.sha,
        shortSha: r.short_sha,
        message: r.message,
        author: r.author,
        date: r.date,
        url: r.url,
      }));

      const { total } = db.prepare("SELECT COUNT(*) AS total FROM commits").get() as {
        total: number;
      };

      return { status: "ok", commits, total };
    } catch (e) {
      return { status: "error", error: e instanceof Error ? e.message : String(e), commits: [] };
    }
  },
);

// Detaliile unui commit, live de pe GitHub.
export const getCommitDetail = createServerFn({ method: "GET" })
  .validator((data: { sha: string }) => {
    assertValidSha(data.sha);
    return data;
  })
  .handler(async ({ data }): Promise<GitHubCommitDetail> => {
    const { requireAdmin } = await import("./auth/admin.server");
    await requireAdmin();
    try {
      // encodeURIComponent pe lângă validare — validarea e ușor de slăbit.
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/commits/${encodeURIComponent(data.sha)}`,
        {
          headers: githubHeaders(),
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!res.ok) throw new Error(`GitHub API a răspuns ${res.status}`);
      const c: GitHubApiCommit = await res.json();

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
        files: (c.files ?? []).map((f) => ({
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
        message: "",
        author: "",
        date: "",
        url: "",
        filesChanged: 0,
        additions: 0,
        deletions: 0,
        files: [],
      };
    }
  });

export interface GitHubSyncStatus {
  deployedSha: string;
  deployedShortSha: string;
  latestSha: string;
  latestShortSha: string;
  isSynced: boolean;
  // Commit-uri pe GitHub care nu rulează încă aici.
  commitsBehind: number;
  // Commit-uri locale, încă nepublicate (push-ul se face manual, din Tehnic).
  commitsAhead: number;
}

// Toate comenzile git sunt asincrone: un `git fetch` sincron (~1,7 s) bloca tot
// procesul, iar prima atingere după revenirea pe telefon „se gândea” ~2 s pe
// orice pagină (3 oct. 2026). Fără shell: argumentele merg ca listă.
const execFileAsync = promisify(execFile);

async function git(args: string[], timeout?: number): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { encoding: "utf8", timeout });
  return stdout.trim();
}

// `git fetch` în fundal, cel mult o dată la 5 minute; răspunsul curent folosește
// referința deja știută. Push-ul din Tehnic o actualizează oricum.
const FETCH_INTERVAL_MS = 5 * 60_000;
let lastFetchAt = 0;
let fetchInFlight: Promise<void> | null = null;

function refreshOriginInBackground(branch: string): void {
  if (fetchInFlight || Date.now() - lastFetchAt < FETCH_INTERVAL_MS) return;
  lastFetchAt = Date.now();
  fetchInFlight = git(["fetch", "--quiet", "origin", branch], 8000)
    .then(() => undefined)
    .catch(() => {
      // Fără rețea sau acces — continuăm cu ce știm local.
    })
    .finally(() => {
      fetchInFlight = null;
    });
}

function currentBranch(): Promise<string> {
  return git(["rev-parse", "--abbrev-ref", "HEAD"]);
}

// Numărătoarea vine din git, nu din lista GitHub: acolo commit-ul local nu
// apare, iar căutarea lui dădea mereu „1 în urmă”, în direcția greșită.
async function gitCounts(): Promise<{ branch: string; ahead: number; behind: number }> {
  const branch = await currentBranch();
  refreshOriginInBackground(branch);
  const [ahead, behind] = await Promise.all([
    git(["rev-list", `origin/${branch}..HEAD`, "--count"]),
    git(["rev-list", `HEAD..origin/${branch}`, "--count"]),
  ]);
  return { branch, ahead: Number(ahead), behind: Number(behind) };
}

export const getGitHubSyncStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    { status: "ok"; data: GitHubSyncStatus } | { status: "error"; error: string }
  > => {
    const { requireAdmin } = await import("./auth/admin.server");
    await requireAdmin();
    try {
      const { branch, ahead, behind } = await gitCounts();
      const [deployedSha, latestSha] = await Promise.all([
        git(["rev-parse", "HEAD"]),
        git(["rev-parse", `origin/${branch}`]),
      ]);

      return {
        status: "ok",
        data: {
          deployedSha,
          deployedShortSha: deployedSha.slice(0, 7),
          latestSha,
          latestShortSha: latestSha.slice(0, 7),
          isSynced: ahead === 0 && behind === 0,
          commitsBehind: behind,
          commitsAhead: ahead,
        },
      };
    } catch (e) {
      return { status: "error", error: e instanceof Error ? e.message : String(e) };
    }
  },
);

export interface GitPushStatus {
  ahead: number;
  behind: number;
  branch: string;
}

// Commit-urile locale nepublicate — pentru butonul de push din Tehnic (față de
// ultima referință cunoscută; fetch-ul e în fundal).
export const getGitPushStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ status: "ok"; data: GitPushStatus } | { status: "error"; error: string }> => {
    const { requireAdmin } = await import("./auth/admin.server");
    await requireAdmin();
    try {
      const { branch, ahead, behind } = await gitCounts();
      return { status: "ok", data: { ahead, behind, branch } };
    } catch (e) {
      return { status: "error", error: e instanceof Error ? e.message : String(e) };
    }
  },
);

export interface UnpushedCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

// Detaliile commit-urilor nepublicate, afișate deasupra butonului de push.
export const getUnpushedCommits = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    { status: "ok"; commits: UnpushedCommit[] } | { status: "error"; error: string }
  > => {
    const { requireAdmin } = await import("./auth/admin.server");
    await requireAdmin();
    try {
      const branch = await currentBranch();
      const sep = "\x1f";
      const log = await git([
        "log",
        `origin/${branch}..HEAD`,
        `--pretty=format:%H${sep}%h${sep}%s${sep}%an${sep}%aI`,
      ]);
      const commits: UnpushedCommit[] = log
        ? log.split("\n").map((line) => {
            const [sha, shortSha, message, author, date] = line.split(sep);
            return { sha, shortSha, message, author, date };
          })
        : [];
      return { status: "ok", commits };
    } catch (e) {
      return { status: "error", error: e instanceof Error ? e.message : String(e) };
    }
  },
);

// Detaliile unui commit local, din git (GitHub nu-l știe încă).
export const getLocalCommitDetail = createServerFn({ method: "GET" })
  .validator((data: { sha: string }) => {
    assertValidSha(data.sha);
    return data;
  })
  .handler(async ({ data }): Promise<GitHubCommitDetail> => {
    const { requireAdmin } = await import("./auth/admin.server");
    await requireAdmin();
    try {
      const sep = "\x1f";
      // `--end-of-options` pe lângă validare: tot ce urmează e revizie, nu
      // opțiune (vezi SHA_RE). Fără trim: %B e ultimul câmp.
      const { stdout: header } = await execFileAsync(
        "git",
        [
          "show",
          "-s",
          `--pretty=format:%H${sep}%h${sep}%B${sep}%an${sep}%aI`,
          "--end-of-options",
          data.sha,
        ],
        { encoding: "utf8" },
      );
      const [sha, shortSha, message, author, date] = header.split(sep);

      const [numstat, nameStatus] = await Promise.all([
        git(["show", "--numstat", "--format=", "--end-of-options", data.sha]),
        git(["show", "--name-status", "--format=", "--end-of-options", data.sha]),
      ]);
      const statusByFile = new Map<string, string>();
      for (const line of nameStatus ? nameStatus.split("\n") : []) {
        const [code, filename] = line.split("\t");
        if (!filename) continue;
        const status =
          code?.[0] === "A"
            ? "added"
            : code?.[0] === "D"
              ? "removed"
              : code?.[0] === "R"
                ? "renamed"
                : "modified";
        statusByFile.set(filename, status);
      }

      const files: GitHubCommitFile[] = (numstat ? numstat.split("\n") : []).map((line) => {
        const [add, del, filename] = line.split("\t");
        return {
          filename,
          status: statusByFile.get(filename) ?? "modified",
          additions: add === "-" ? 0 : Number(add),
          deletions: del === "-" ? 0 : Number(del),
        };
      });

      return {
        status: "ok",
        sha,
        shortSha,
        message: message.trim(),
        author,
        date,
        url: "",
        filesChanged: files.length,
        additions: files.reduce((s, f) => s + f.additions, 0),
        deletions: files.reduce((s, f) => s + f.deletions, 0),
        files,
      };
    } catch (e) {
      return {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
        sha: data.sha,
        shortSha: data.sha.slice(0, 7),
        message: "",
        author: "",
        date: "",
        url: "",
        filesChanged: 0,
        additions: 0,
        deletions: 0,
        files: [],
      };
    }
  });

export interface GitPushResult {
  status: "ok" | "error";
  error?: string;
  pushedCommits: number;
}

// Publică pe GitHub commit-urile locale — manual, din Tehnic. Build-ul și
// restartul s-au făcut deja la commit.
export const pushToGitHub = createServerFn({ method: "POST" }).handler(
  async (): Promise<GitPushResult> => {
    const { requireAdmin } = await import("./auth/admin.server");
    await requireAdmin();
    try {
      const branch = await currentBranch();
      const ahead = Number(await git(["rev-list", `origin/${branch}..HEAD`, "--count"]));
      if (ahead === 0) {
        return { status: "ok", pushedCommits: 0 };
      }
      await git(["push", "origin", branch], 30_000);
      // Commit-urile publicate intră imediat în DB, cu notificarea lor. O
      // sincronizare picată nu face push-ul eșuat — polling-ul din Tehnic o reia.
      const { syncCommitsFromGitHub } = await import("./github-commits.server");
      await syncCommitsFromGitHub().catch((e) =>
        console.warn("[github] Sincronizarea de după push a eșuat:", e),
      );
      return { status: "ok", pushedCommits: ahead };
    } catch (e) {
      return {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
        pushedCommits: 0,
      };
    }
  },
);
