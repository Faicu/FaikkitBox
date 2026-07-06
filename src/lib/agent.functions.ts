import { createServerFn } from "@tanstack/react-start";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AgentCommand =
  | "apt_update"
  | "apt_upgrade"
  | "flush_dns"
  | "restart_plex"
  | "restart_immich"
  | "restart_qbit"
  | "update_plex"
  | "update_immich"
  | "uptime"
  | "deploy_app";

const ALLOWED: AgentCommand[] = [
  "apt_update",
  "apt_upgrade",
  "flush_dns",
  "restart_plex",
  "restart_immich",
  "restart_qbit",
  "update_plex",
  "update_immich",
  "uptime",
  "deploy_app",
];

export type AgentResult = {
  ok: boolean;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
};

// Un pas e fie un argv (rulat direct, fara shell), fie o pauza intre pasi,
// fie un spawn detasat (pentru comenzi care restarteaza procesul curent).
type Step = { argv: string[] } | { sleepMs: number } | { spawnDetached: string[] };

// Caile compose sunt configurabile via env, cu valori implicite conform
// instalarii curente (/root/plex si /root/immich-app).
function commandSteps(cmd: AgentCommand): Step[] {
  const plexCompose = process.env.PLEX_COMPOSE_FILE ?? "/root/plex/docker-compose.yml";
  const immichCompose = process.env.IMMICH_COMPOSE_FILE ?? "/root/immich-app/docker-compose.yml";

  switch (cmd) {
    case "apt_update":
      return [{ argv: ["sudo", "apt-get", "update"] }];
    case "apt_upgrade":
      return [{ argv: ["sudo", "apt-get", "-y", "upgrade"] }];
    case "flush_dns":
      return [
        { argv: ["sudo", "resolvectl", "flush-caches"] },
        { sleepMs: 2000 },
        { argv: ["sudo", "systemctl", "restart", "qbittorrent-nox"] },
      ];
    case "restart_plex":
      // "sudo" e necesar aici nu doar pentru docker, ci si pentru ca /root/plex
      // e ilizibil pentru orice user in afara de root (permisiuni implicite 700).
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
    case "deploy_app":
      // deploy.sh face systemctl restart care omoară procesul curent —
      // folosim spawn detașat și returnăm imediat
      return [{ spawnDetached: ["sudo", "/opt/faikkitbox/deploy.sh"] }];
  }
}

export const runAgentCommand = createServerFn({ method: "POST" })
  .inputValidator((data: { cmd: AgentCommand }) => {
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
        // Spawn detașat — lansează procesul și returnează imediat fără să aștepte
        if ("spawnDetached" in step) {
          const [dcmd, ...dargs] = step.spawnDetached;
          stdoutParts.push(`$ ${step.spawnDetached.join(" ")} (detașat)\n`);
          const child = spawn(dcmd, dargs, {
            detached: true,
            stdio: "ignore",
          });
          child.unref();
          stdoutParts.push("Deploy pornit în background — aplicația va reporni în câteva minute.\n");
          return { ok: true, exit_code: 0, stdout: stdoutParts.join(""), stderr: "" };
        }
        const [cmd, ...args] = step.argv;
        stdoutParts.push(`$ ${step.argv.join(" ")}\n`);        try {
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
