import { createServerFn } from "@tanstack/react-start";
import { execSync, execFileSync } from "child_process";

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
  // Doar din getCommitsFromDb: câte sunt în DB în total — lista e plafonată
  // la 500, deci lungimea ei nu mai e totalul.
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

// Un SHA de git e hex, atât. Validarea NU e cosmetică: `data.sha` ajunge
// argument pentru `git show`, iar execFileSync nu folosește shell, deci nu
// există injecție de shell — dar există injecție de ARGUMENT. `git show`
// acceptă opțiunile de diff, printre care `--output=<fișier>`: un sha de
// forma "--output=/root/.ssh/authorized_keys" scrie liniștit în calea aia.
// Serviciul rulează ca root, deci era o scriere arbitrară de fișier ca root,
// pornind de la o sesiune de admin — exact genul de acces pe care restul
// aplicației îl evită cu grijă (vezi jobSteps din system/service-jobs.ts, unde
// argumentele nu vin niciodată de la client).
//
// Verificat pe repo-ul ăsta: `git show --numstat --format= --output=/tmp/x`
// chiar creează /tmp/x.
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

// Fetch GitHub + upsert în DB (rulat periodic din React Query)
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

// Citește commits din DB — sursa principală pentru timeline
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

// Detalii complete pentru un commit — live de pe GitHub, la cerere
export const getCommitDetail = createServerFn({ method: "GET" })
  .validator((data: { sha: string }) => {
    assertValidSha(data.sha);
    return data;
  })
  .handler(async ({ data }): Promise<GitHubCommitDetail> => {
    const { requireAdmin } = await import("./auth/admin.server");
    await requireAdmin();
    try {
      // encodeURIComponent în plus față de validare: sha e interpolat într-o
      // cale de URL, iar validarea singură e ușor de slăbit din greșeală mai
      // târziu.
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

// Numărătoarea vine din git (origin/<branch> după un fetch best-effort), nu din
// lista de commit-uri de pe GitHub: acolo commit-ul local nepublicat nu apare
// deloc, iar căutarea lui în listă dădea mereu "1 în urmă", indiferent câte
// commit-uri erau de fapt — și în direcția greșită (serverul era înainte).
function gitCounts(): { branch: string; ahead: number; behind: number } {
  const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
  try {
    execFileSync("git", ["fetch", "--quiet", "origin", branch], { timeout: 8000 });
  } catch {
    // fără rețea sau fără acces — continuăm cu ce știm local
  }
  const ahead = Number(
    execSync(`git rev-list origin/${branch}..HEAD --count`, { encoding: "utf8" }).trim(),
  );
  const behind = Number(
    execSync(`git rev-list HEAD..origin/${branch} --count`, { encoding: "utf8" }).trim(),
  );
  return { branch, ahead, behind };
}

export const getGitHubSyncStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    { status: "ok"; data: GitHubSyncStatus } | { status: "error"; error: string }
  > => {
    const { requireAdmin } = await import("./auth/admin.server");
    await requireAdmin();
    try {
      const { branch, ahead, behind } = gitCounts();
      const deployedSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
      const latestSha = execSync(`git rev-parse origin/${branch}`, { encoding: "utf8" }).trim();

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

// Numărul de commit-uri locale nepublicate — sursa pentru butonul de push din
// pagina Tehnic. `git fetch` e best-effort (doar actualizează referința locală
// origin/main, nu schimbă nimic din working tree); dacă eșuează (fără rețea),
// raportăm ahead/behind față de ultima referință cunoscută.
export const getGitPushStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ status: "ok"; data: GitPushStatus } | { status: "error"; error: string }> => {
    const { requireAdmin } = await import("./auth/admin.server");
    await requireAdmin();
    try {
      const { branch, ahead, behind } = gitCounts();
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

// Detalii despre commit-urile locale nepublicate — afișate deasupra butonului
// de push din pagina Tehnic, ca userul să vadă ce urmează să trimită.
export const getUnpushedCommits = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    { status: "ok"; commits: UnpushedCommit[] } | { status: "error"; error: string }
  > => {
    const { requireAdmin } = await import("./auth/admin.server");
    await requireAdmin();
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
      const sep = "\x1f";
      const log = execSync(
        `git log origin/${branch}..HEAD --pretty=format:%H${sep}%h${sep}%s${sep}%an${sep}%aI`,
        { encoding: "utf8" },
      ).trim();
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

// Detalii complete pentru un commit local (nepublicat încă pe GitHub) — citite
// direct din git, fiindcă GitHub API nu are cum să știe de el.
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
      // `--end-of-options` peste validarea din validator: de aici încolo git
      // tratează orice urmează ca revizie, nu ca opțiune, chiar dacă cineva
      // slăbește cândva regexul. Două straturi, fiindcă greșeala aici scrie
      // fișiere ca root (vezi SHA_RE).
      const header = execFileSync(
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

      const numstat = execFileSync(
        "git",
        ["show", "--numstat", "--format=", "--end-of-options", data.sha],
        { encoding: "utf8" },
      ).trim();
      const nameStatus = execFileSync(
        "git",
        ["show", "--name-status", "--format=", "--end-of-options", data.sha],
        { encoding: "utf8" },
      ).trim();
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

// Trimite commit-urile locale pe GitHub — apăsat manual din pagina Tehnic.
// Nu rulează build/restart: acelea s-au întâmplat deja când commit-urile au
// fost create local, push-ul doar le publică.
export const pushToGitHub = createServerFn({ method: "POST" }).handler(
  async (): Promise<GitPushResult> => {
    const { requireAdmin } = await import("./auth/admin.server");
    await requireAdmin();
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
      const ahead = Number(
        execSync(`git rev-list origin/${branch}..HEAD --count`, { encoding: "utf8" }).trim(),
      );
      if (ahead === 0) {
        return { status: "ok", pushedCommits: 0 };
      }
      execFileSync("git", ["push", "origin", branch], { timeout: 30_000 });
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
