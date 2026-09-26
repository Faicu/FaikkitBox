// ---------------------------------------------------------------------------
// Acțiunile pe servicii: Restart și Update pentru Plex, Immich, qBittorrent și
// Ubuntu — un singur mecanism pentru toate.
//
// Înainte, fiecare buton rula comanda ÎN cererea HTTP (până la 30 de minute),
// iar jurnalul îl scria browserul, după răspuns. Aplicația trece prin
// Cloudflare Tunnel, care taie cererile lungi, deci la un update lung pagina
// primea eroare, deși comanda continua, iar intrarea din jurnal se pierdea.
// Ubuntu avea în plus propriul cod, separat, cu alt comportament.
//
// Acum: pornirea întoarce imediat, comanda rulează în fundal pe server, starea
// și ieșirea se scriu în `service_jobs`, iar jurnalul îl scrie serverul, la
// final. O singură acțiune odată, pe toate serviciile: un `apt-get upgrade`
// poate atinge docker, iar două acțiuni simultane pe același serviciu s-ar
// călca pe picioare.
//
// Comenzile de mai jos trebuie să existe identic în
// deploy/hardening/faikkitbox.sudoers — altfel sudo le refuză.
//
// Server-only (node:child_process).
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { getDb } from "../db";

export type ServiceKey = "plex" | "immich" | "qbit" | "ubuntu";
export type JobKind = "restart" | "update";
export type JobStatus = "running" | "ok" | "failed" | "interrupted";

export interface ServiceJob {
  id: number;
  service: ServiceKey;
  kind: JobKind;
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  output: string;
}

export const SERVICE_LABELS: Record<ServiceKey, string> = {
  plex: "Plex",
  immich: "Immich",
  qbit: "qBittorrent",
  ubuntu: "Ubuntu",
};

type Step = { argv: string[]; env?: Record<string, string> } | { sleepMs: number };

const PLEX_COMPOSE = process.env.PLEX_COMPOSE_FILE ?? "/root/plex/docker-compose.yml";
const IMMICH_COMPOSE = process.env.IMMICH_COMPOSE_FILE ?? "/root/immich-app/docker-compose.yml";

const compose = (file: string, ...args: string[]): Step => ({
  argv: ["sudo", "-n", "/usr/bin/docker-compose", "-f", file, ...args],
});

// null = acțiune inexistentă (qBittorrent nu se actualizează niciodată din
// aplicație; repornirea Ubuntu e tratată separat, vezi rebootUbuntu).
export function jobSteps(service: ServiceKey, kind: JobKind): Step[] | null {
  switch (`${service}:${kind}`) {
    case "plex:restart":
      return [compose(PLEX_COMPOSE, "restart")];
    case "plex:update":
      // Imaginea `beta` își instalează singură ultima versiune Plex la
      // pornirea containerului (cont-init.d/50-plex-update), deci containerul
      // trebuie recreat chiar dacă imaginea n-a avut ce descărca — un `up -d`
      // simplu nu l-ar atinge. `pull` întâi, cu Plex încă pornit: oprirea
      // durează cât repornirea, nu cât descărcarea.
      return [compose(PLEX_COMPOSE, "pull"), compose(PLEX_COMPOSE, "up", "-d", "--force-recreate")];
    case "immich:restart":
      return [compose(IMMICH_COMPOSE, "restart")];
    case "immich:update":
      // `up -d` recreează doar containerele cu imagine nouă.
      return [compose(IMMICH_COMPOSE, "pull"), compose(IMMICH_COMPOSE, "up", "-d")];
    case "qbit:restart":
      return [
        { argv: ["sudo", "-n", "/usr/bin/resolvectl", "flush-caches"] },
        { sleepMs: 2000 },
        { argv: ["sudo", "-n", "/usr/bin/systemctl", "restart", "qbittorrent-nox"] },
      ];
    case "ubuntu:update": {
      // Fără nicio întrebare interactivă: fișierele de configurare modificate
      // local se păstrează (confold), cele nemodificate se înlocuiesc
      // (confdef). DEBIAN_FRONTEND trece prin sudo datorită env_keep din
      // sudoers.
      const env = { DEBIAN_FRONTEND: "noninteractive" };
      return [
        { argv: ["sudo", "-n", "/usr/bin/apt-get", "update"], env },
        {
          argv: [
            "sudo",
            "-n",
            "/usr/bin/apt-get",
            "-y",
            "-o",
            "Dpkg::Options::=--force-confdef",
            "-o",
            "Dpkg::Options::=--force-confold",
            "upgrade",
          ],
          env,
        },
      ];
    }
    default:
      return null;
  }
}

const OUTPUT_LIMIT = 64_000;
const STEP_TIMEOUT_MS = 30 * 60_000;

function rowToJob(r: Record<string, unknown>): ServiceJob {
  return {
    id: Number(r.id),
    service: r.service as ServiceKey,
    kind: r.kind as JobKind,
    status: r.status as JobStatus,
    startedAt: String(r.started_at),
    finishedAt: (r.finished_at as string | null) ?? null,
    exitCode: r.exit_code == null ? null : Number(r.exit_code),
    output: String(r.output ?? ""),
  };
}

export function runningJob(): ServiceJob | null {
  const r = getDb()
    .prepare("SELECT * FROM service_jobs WHERE status = 'running' ORDER BY id DESC LIMIT 1")
    .get() as Record<string, unknown> | undefined;
  return r ? rowToJob(r) : null;
}

// Ultima acțiune a fiecărui serviciu — ce afișează paginile.
export function latestJobs(): Partial<Record<ServiceKey, ServiceJob>> {
  const rows = getDb()
    .prepare(
      `SELECT * FROM service_jobs WHERE id IN (SELECT MAX(id) FROM service_jobs GROUP BY service)`,
    )
    .all() as Record<string, unknown>[];
  return Object.fromEntries(rows.map((r) => [r.service, rowToJob(r)]));
}

export function jobLabel(service: ServiceKey, kind: JobKind): string {
  return `${kind === "restart" ? "Restart" : "Update"} ${SERVICE_LABELS[service]}`;
}

// Mesajul din jurnal — același tipar pentru toate.
export function jobMessage(
  service: ServiceKey,
  kind: JobKind,
  status: JobStatus,
  output: string,
  exitCode: number | null,
): string {
  const name = SERVICE_LABELS[service];
  let msg: string;
  if (kind === "restart") {
    msg =
      service === "qbit"
        ? "qBittorrent a fost repornit (cache DNS curățat)"
        : service === "ubuntu"
          ? "Ubuntu: sistemul se repornește"
          : `${name} a fost repornit`;
  } else if (service === "ubuntu") {
    const n = /(\d+) upgraded/.exec(output)?.[1];
    msg = n ? `Ubuntu actualizat: ${n} ${n === "1" ? "pachet" : "pachete"}` : "Ubuntu actualizat";
  } else {
    msg = `${name} a fost actualizat`;
  }
  if (status === "failed") return `${msg} — EȘUAT${exitCode != null ? ` (exit ${exitCode})` : ""}`;
  if (status === "interrupted")
    return `${jobLabel(service, kind)} — întrerupt de o repornire a aplicației`;
  return msg;
}

async function logJob(job: {
  service: ServiceKey;
  kind: JobKind;
  status: JobStatus;
  output: string;
  exitCode: number | null;
}): Promise<void> {
  const { logActivity } = await import("../activity-log");
  const type =
    job.kind === "restart"
      ? "service_restart"
      : job.service === "ubuntu"
        ? "ubuntu_update"
        : "service_update";
  await logActivity(type, jobMessage(job.service, job.kind, job.status, job.output, job.exitCode), {
    service: job.service,
    kind: job.kind,
    ok: job.status === "ok",
  });
}

export class JobRejected extends Error {}

// Pornește acțiunea și întoarce imediat id-ul; restul se vede în service_jobs.
export async function startServiceJob(service: ServiceKey, kind: JobKind): Promise<number> {
  const busy = runningJob();
  if (busy) throw new JobRejected(`Rulează deja: ${jobLabel(busy.service, busy.kind)}`);

  if (service === "ubuntu" && kind === "restart") return rebootUbuntu();

  const steps = jobSteps(service, kind);
  if (!steps) throw new JobRejected(`${jobLabel(service, kind)} nu există`);

  const db = getDb();
  const id = Number(
    db
      .prepare(
        `INSERT INTO service_jobs (service, kind, status, started_at) VALUES (?, ?, 'running', ?)`,
      )
      .run(service, kind, new Date().toISOString()).lastInsertRowid,
  );
  void runSteps(id, service, kind, steps);
  return id;
}

async function runSteps(id: number, service: ServiceKey, kind: JobKind, steps: Step[]) {
  const db = getDb();
  let output = "";
  let dirty = false;
  const flush = () => {
    if (!dirty) return;
    dirty = false;
    db.prepare("UPDATE service_jobs SET output = ? WHERE id = ?").run(output, id);
  };
  const append = (text: string) => {
    output += text;
    if (output.length > OUTPUT_LIMIT) output = `…\n${output.slice(-OUTPUT_LIMIT)}`;
    dirty = true;
  };
  // Ieșirea apare live în pagină, dar scrisă în DB cel mult o dată pe secundă.
  const ticker = setInterval(flush, 1000);

  let exitCode = 0;
  try {
    for (const step of steps) {
      if ("sleepMs" in step) {
        append(`[pauză ${step.sleepMs / 1000}s]\n`);
        await new Promise((r) => setTimeout(r, step.sleepMs));
        continue;
      }
      append(`$ ${step.argv.slice(2).join(" ")}\n`);
      exitCode = await runStep(step, append);
      if (exitCode !== 0) break;
    }
  } catch (e) {
    append(`\n${(e as Error).message}\n`);
    exitCode = exitCode || 1;
  } finally {
    clearInterval(ticker);
  }

  const status: JobStatus = exitCode === 0 ? "ok" : "failed";
  db.prepare(
    "UPDATE service_jobs SET status = ?, finished_at = ?, exit_code = ?, output = ? WHERE id = ?",
  ).run(status, new Date().toISOString(), exitCode, output, id);
  await logJob({ service, kind, status, output, exitCode });
}

function runStep(
  step: { argv: string[]; env?: Record<string, string> },
  append: (t: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const [cmd, ...args] = step.argv;
    const child = spawn(cmd, args, {
      env: { ...process.env, LC_ALL: "C", ...step.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      append(`\n[oprit după ${STEP_TIMEOUT_MS / 60_000} minute]\n`);
      child.kill("SIGTERM");
    }, STEP_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => append(d.toString()));
    child.stderr.on("data", (d: Buffer) => append(d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      append(`${e.message}\n`);
      resolve(1);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

// Repornirea sistemului omoară și procesul nostru, deci totul se scrie
// ÎNAINTE: acțiunea e marcată reușită și jurnalul completat, apoi se cere
// reboot-ul. Dacă sudo îl refuză, starea se corectează imediat.
async function rebootUbuntu(): Promise<number> {
  const { readUbuntuStatus } = await import("./ubuntu-status");
  const st = await readUbuntuStatus();
  if (!st.rebootRequired) throw new JobRejected("Sistemul nu cere repornire");

  const db = getDb();
  const now = new Date().toISOString();
  const output = `$ systemctl reboot\nPachete care au cerut repornirea: ${st.rebootPackages.join(", ") || "—"}\n`;
  const id = Number(
    db
      .prepare(
        `INSERT INTO service_jobs (service, kind, status, started_at, finished_at, exit_code, output)
         VALUES ('ubuntu', 'restart', 'ok', ?, ?, 0, ?)`,
      )
      .run(now, now, output).lastInsertRowid,
  );
  await logJob({ service: "ubuntu", kind: "restart", status: "ok", output, exitCode: 0 });

  // Câteva secunde, ca răspunsul să ajungă la pagină înainte să cadă totul.
  setTimeout(() => {
    runStep({ argv: ["sudo", "-n", "/usr/bin/systemctl", "reboot"] }, () => {}).then((code) => {
      if (code === 0) return;
      db.prepare(
        "UPDATE service_jobs SET status = 'failed', exit_code = ?, output = output || ? WHERE id = ?",
      ).run(code, `\nsudo a refuzat repornirea (exit ${code})\n`, id);
      void logJob({ service: "ubuntu", kind: "restart", status: "failed", output, exitCode: code });
    });
  }, 3000);
  return id;
}

// La pornirea aplicației: o acțiune rămasă „running” a murit odată cu
// procesul anterior (systemd oprește și procesele copil).
export async function markInterruptedJobs(): Promise<void> {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM service_jobs WHERE status = 'running'").all() as Record<
    string,
    unknown
  >[];
  for (const r of rows) {
    const job = rowToJob(r);
    db.prepare("UPDATE service_jobs SET status = 'interrupted', finished_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      job.id,
    );
    await logJob({ ...job, status: "interrupted" });
  }
}
