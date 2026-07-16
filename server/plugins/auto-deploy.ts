import { execSync, spawn } from "child_process";
import { broadcastDeploy } from "../lib/broadcaster";

const GITHUB_REPO = process.env.GITHUB_REPO ?? "Faicu/FaikkitBox";
const REPO_DIR = process.env.FAIKKITBOX_REPO_DIR ?? "/opt/faikkitbox";
const SERVICE = process.env.FAIKKITBOX_SERVICE ?? "faikkitbox";

function broadcast(event: string, data: string) {
  console.log(`[auto-deploy] ${event}: ${data}`);
  broadcastDeploy(event, data);
}

let deploying = false;

function runCommand(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: REPO_DIR, stdio: ["ignore", "pipe", "pipe"] });
    const onData = (chunk: Buffer) => {
      chunk.toString().split("\n").filter(l => l.trim()).forEach(line => broadcast("log", line));
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => resolve(code ?? 0));
    child.on("error", (e) => { broadcast("log", `Eroare: ${e.message}`); resolve(1); });
  });
}

async function deploy(latestSha: string) {
  if (deploying) return;
  deploying = true;

  try {
    broadcast("step", "📥 git pull --ff-only");
    const pullCode = await runCommand("git", ["-C", REPO_DIR, "pull", "--ff-only"]);
    if (pullCode !== 0) { broadcast("error", "git pull a eșuat — deploy anulat"); return; }

    broadcast("step", "🔨 npm run build");
    const buildCode = await runCommand("npm", ["--prefix", REPO_DIR, "run", "build"]);
    if (buildCode !== 0) { broadcast("error", "build a eșuat — deploy anulat"); return; }

    broadcast("step", "🔄 Repornire serviciu...");
    await runCommand("sudo", [
      "systemd-run", "--on-active=2s",
      "--unit=faikkitbox-autorestart", "--collect",
      "systemctl", "restart", SERVICE,
    ]);
    broadcast("done", "Deploy finalizat — se repornește...");
  } finally {
    deploying = false;
  }
}

async function checkGitHub() {
  if (deploying) return;
  try {
    const headers: Record<string, string> = {
      "User-Agent": "faikkitbox",
      Accept: "application/vnd.github+json",
    };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/commits?per_page=1`,
      { headers, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return;
    const [latest] = await res.json() as any[];
    const latestSha = String(latest?.sha ?? "");
    if (!latestSha) return;

    const currentSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    if (latestSha !== currentSha) {
      broadcast("detected", `Commit nou detectat: ${latestSha.slice(0, 7)} — pornesc deploy automat`);
      await deploy(latestSha);
    }
  } catch {
    // rețea sau GitHub indisponibil temporar
  }
}

export default function () {
  setTimeout(checkGitHub, 15_000);
  setInterval(checkGitHub, 60_000);
}
