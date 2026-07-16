import { createServerFn } from "@tanstack/react-start";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AgentCommand =
  | "apt_update"
  | "apt_upgrade"
  | "apt_full_upgrade"
  | "deploy_app"
  | "flush_dns"
  | "restart_plex"
  | "restart_immich"
  | "restart_qbit"
  | "update_plex"
  | "update_immich"
  | "uptime";

const ALLOWED: AgentCommand[] = [
  "apt_update",
  "apt_upgrade",
  "apt_full_upgrade",
  "deploy_app",
  "flush_dns",
  "restart_plex",
  "restart_immich",
  "restart_qbit",
  "update_plex",
  "update_immich",
  "uptime",
];

export type AgentResult = {
  ok: boolean;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
};

type Step = { argv: string[] } | { sleepMs: number };

// Caile compose sunt configurabile via env, cu valori implicite conform
// instalarii curente (/root/plex si /root/immich-app).
function commandSteps(cmd: AgentCommand): Step[] {
  const plexCompose = process.env.PLEX_COMPOSE_FILE ?? "/root/plex/docker-compose.yml";
  const immichCompose = process.env.IMMICH_COMPOSE_FILE ?? "/root/immich-app/docker-compose.yml";
  const appRepoDir = process.env.FAIKKITBOX_REPO_DIR ?? "/opt/faikkitbox";
  const appService = process.env.FAIKKITBOX_SERVICE ?? "faikkitbox";

  switch (cmd) {
    case "apt_update":
      return [{ argv: ["sudo", "apt-get", "update"] }];
    case "apt_upgrade":
      return [{ argv: ["sudo", "apt-get", "-y", "upgrade"] }];
    case "apt_full_upgrade":
      return [
        { argv: ["sudo", "apt-get", "update"] },
        { argv: ["sudo", "apt-get", "-y", "upgrade"] },
      ];
    case "deploy_app":
      return [
        { argv: ["git", "-C", appRepoDir, "pull", "--ff-only"] },
        { argv: ["npm", "--prefix", appRepoDir, "run", "build"] },
        {
          argv: [
            "sudo",
            "systemd-run",
            "--on-active=1s",
            "--unit=faikkitbox-restart",
            "--collect",
            "systemctl",
            "restart",
            appService,
          ],
        },
      ];
    case "flush_dns":
      return [
        { argv: ["sudo", "resolvectl", "flush-caches"] },
        { sleepMs: 2000 },
        { argv: ["sudo", "systemctl", "restart", "qbittorrent-nox"] },
      ];
    case "restart_plex":
      return [{ argv: ["sudo", "docker-compose", "-f", plexCompose, "restart"] }];
    case "restart_immich":
      return [{ argv: ["sudo", "docker-compose", "-f", immichCompose, "restart"] }];
    case "restart_qbit":
      return [{ argv: ["sudo", "systemctl", "restart", "qbittorrent-nox"] }];
    case "update_plex":
      return [
        { argv: ["sudo", "docker-compose", "-f", plexCompose, "down"] },
        { argv: ["sudo", "docker-compose", "-f", plexCompose, "pull"] },
        { argv: ["sudo", "docker-compose", "-f", plexCompose, "up", "-d"] },
      ];
    case "update_immich":
      return [
        { argv: ["sudo", "docker-compose", "-f", immichCompose, "down"] },
        { argv: ["sudo", "docker-compose", "-f", immichCompose, "pull"] },
        { argv: ["sudo", "docker-compose", "-f", immichCompose, "up", "-d"] },
      ];
    case "uptime":
      return [{ argv: ["uptime"] }];
  }
}

export const runAgentCommand = createServerFn({ method: "POST" })
  .validator((data: { cmd: AgentCommand }) => {
    if (!ALLOWED.includes(data.cmd)) {
      throw new Error(`Comanda nu este permisă: ${data.cmd}`);
    }
    return data;
  })
  .handler(async ({ data }): Promise<AgentResult> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();

    const steps = commandSteps(data.cmd);
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];
    let lastCode = 0;

    try {
      for (const step of steps) {
        if ("sleepMs" in step) {
          await new Promise((r) => setTimeout(r, step.sleepMs));
          stdoutParts.push(`[sleep ${step.sleepMs / 1000}s]\n`);
          continue;
        }
        const [cmd, ...args] = step.argv;
        stdoutParts.push(`$ ${step.argv.join(" ")}\n`);
        try {
          const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 1_800_000 });
          if (stdout) stdoutParts.push(stdout);
          if (stderr) stderrParts.push(stderr);
        } catch (e: any) {
          lastCode = typeof e.code === "number" ? e.code : 1;
          if (e.stdout) stdoutParts.push(e.stdout);
          if (e.stderr) stderrParts.push(e.stderr);
          else stderrParts.push(e.message ?? String(e));
          break;
        }
      }
      return {
        ok: lastCode === 0,
        exit_code: lastCode,
        stdout: stdoutParts.join(""),
        stderr: stderrParts.join(""),
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

// Logging activitate agenți (fire and forget, după execuție)
export async function logAgentActivity(cmd: AgentCommand, ok: boolean): Promise<void> {
  const { logActivity } = await import("./activity-log");
  const messages: Partial<Record<AgentCommand, string>> = {
    restart_plex: "Plex a fost repornit",
    restart_immich: "Immich a fost repornit",
    restart_qbit: "qBittorrent a fost repornit",
    deploy_app: "Aplicația FaikkitBox a fost actualizată (pull + build + restart)",
    update_plex: "Plex a fost actualizat (docker pull + up)",
    update_immich: "Immich a fost actualizat (docker pull + up)",
    apt_update: "Ubuntu: apt-get update rulat",
    apt_upgrade: "Ubuntu: apt-get upgrade rulat",
    apt_full_upgrade: "Ubuntu actualizat complet (update + upgrade)",
    flush_dns: "Cache DNS curățat + qBittorrent repornit",
    uptime: undefined,
  };
  const msg = messages[cmd];
  if (!msg) return;
  const type =
    cmd === "deploy_app"
      ? "service_update"
      : cmd.startsWith("update_")
        ? "service_update"
        : cmd.startsWith("restart_")
          ? "service_restart"
          : "ubuntu_update";
  await logActivity(type as any, ok ? msg : `${msg} — EȘUAT`, { cmd, ok });
}
