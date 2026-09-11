// Backup-ul bazei de date. Server-only (node:fs, node:path) — vezi regula din
// STRUCTURE.md: server functions stau în db-backup.functions.ts.
//
// `data/faikkitbox.db` ține absolut tot: bibliotecă, conturi, jurnal,
// abonamente push. Până acum nu exista niciun backup — nici script, nici cron
// — deci un disc mort sau o migrare greșită din runCleanups însemna pierdere
// totală, ireversibilă.
//
// Copierea se face cu `VACUUM INTO`, nu cu copiere de fișier: baza rulează în
// mod WAL, deci un `cp` prinde un .db fără tranzacțiile încă necheckpoint-ate
// din -wal (4 MB de WAL peste 1.4 MB de bază, în cazul nostru) și poate da o
// copie coruptă. VACUUM INTO e atomic, consistent la nivel de tranzacție și
// scrie un fișier deja compactat, fără WAL separat.

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { getDb } from "../db";

// Câte backup-uri păstrăm. La ~1 MB per copie compactată, două săptămâni de
// istoric zilnic costă sub 20 MB — destul cât să prinzi o stricăciune care
// s-a strecurat acum câteva zile, nu doar pe cea de azi-dimineață.
const KEEP_BACKUPS = 14;

const BACKUP_PREFIX = "faikkitbox-";
const BACKUP_SUFFIX = ".db";

export interface BackupFile {
  name: string;
  path: string;
  size: number;
  createdAt: string; // ISO
}

export interface BackupStatus {
  dir: string;
  backups: BackupFile[];
  lastAt: string | null;
  totalSize: number;
  keep: number;
}

export type BackupResult =
  | { ok: true; file: BackupFile; removed: number }
  | { ok: false; error: string };

function dbPath(): string {
  return process.env.FAIKKITBOX_DB_PATH ?? "/opt/faikkitbox/data/faikkitbox.db";
}

export function backupDir(): string {
  return process.env.FAIKKITBOX_BACKUP_DIR ?? join(dirname(dbPath()), "backups");
}

// Numele fișierului poartă momentul, în UTC, cu ":" înlocuit (nevalid pe unele
// sisteme de fișiere). Sortarea alfabetică a numelor = sortare cronologică,
// deci rotația de mai jos n-are nevoie de mtime.
function backupName(when: Date): string {
  return `${BACKUP_PREFIX}${when.toISOString().replace(/:/g, "-").replace(/\..+$/, "")}Z${BACKUP_SUFFIX}`;
}

function toBackupFile(dir: string, name: string): BackupFile {
  const path = join(dir, name);
  const st = statSync(path);
  return { name, path, size: st.size, createdAt: st.mtime.toISOString() };
}

export function listBackups(): BackupFile[] {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.startsWith(BACKUP_PREFIX) && n.endsWith(BACKUP_SUFFIX))
    .sort()
    .reverse() // cel mai recent primul
    .map((n) => toBackupFile(dir, n));
}

export function getBackupStatus(): BackupStatus {
  const backups = listBackups();
  return {
    dir: backupDir(),
    backups,
    lastAt: backups[0]?.createdAt ?? null,
    totalSize: backups.reduce((s, b) => s + b.size, 0),
    keep: KEEP_BACKUPS,
  };
}

export function runDbBackup(): BackupResult {
  try {
    const dir = backupDir();
    mkdirSync(dir, { recursive: true });

    const target = join(dir, backupName(new Date()));
    if (existsSync(target)) {
      // Două rulări în aceeași secundă (backup manual peste cel automat):
      // VACUUM INTO refuză o țintă existentă, deci nu suprascriem nimic.
      return { ok: false, error: "Există deja un backup cu același nume" };
    }

    // Ghilimele simple, cu escape — calea vine din env, nu din UI, dar
    // VACUUM INTO nu acceptă parametri legați, deci literalul e singura cale.
    getDb().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

    const removed = pruneBackups();
    return { ok: true, file: toBackupFile(dir, target.split("/").pop()!), removed };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[backup] Backup eșuat:", error);
    return { ok: false, error };
  }
}

function pruneBackups(): number {
  const all = listBackups(); // deja sortate descrescător
  const extra = all.slice(KEEP_BACKUPS);
  let removed = 0;
  for (const b of extra) {
    try {
      unlinkSync(b.path);
      removed++;
    } catch (e) {
      console.warn(`[backup] Nu am putut șterge ${b.name}:`, e);
    }
  }
  return removed;
}
