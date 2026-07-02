import { createServerFn } from "@tanstack/react-start";

export type AgentCommand =
  | "apt_update"
  | "apt_upgrade"
  | "flush_dns"
  | "restart_plex"
  | "restart_immich"
  | "restart_qbit"
  | "uptime";

const ALLOWED: AgentCommand[] = [
  "apt_update",
  "apt_upgrade",
  "flush_dns",
  "restart_plex",
  "restart_immich",
  "restart_qbit",
  "uptime",
];

export type AgentResult = {
  ok: boolean;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
};

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
    const url = process.env.AGENT_URL;
    const token = process.env.AGENT_TOKEN;
    if (!url || !token) {
      return { ok: false, error: "AGENT_URL sau AGENT_TOKEN nu sunt configurate." };
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1_800_000);
      const res = await fetch(`${url.replace(/\/$/, "")}/exec`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cmd: data.cmd }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const text = await res.text();
      let body: any = {};
      try {
        body = JSON.parse(text);
      } catch {
        return { ok: false, error: `Răspuns invalid de la agent (HTTP ${res.status}): ${text.slice(0, 200)}` };
      }
      if (!res.ok) {
        return { ok: false, error: body.error ?? `HTTP ${res.status}`, stdout: body.stdout, stderr: body.stderr };
      }
      return {
        ok: (body.exit_code ?? 0) === 0,
        exit_code: body.exit_code,
        stdout: body.stdout ?? "",
        stderr: body.stderr ?? "",
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });