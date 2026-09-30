// ---------------------------------------------------------------------------
// Ultimul APK al aplicației VW Welcome, încărcat de CI (POST /api/vw-apk) și descărcat
// de aplicație pentru actualizarea din aplicație. Un singur fișier + metadate. Server-only.
// ---------------------------------------------------------------------------

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export interface VwApkInfo {
  versionCode: number;
  versionName: string;
  size: number;
  uploadedAt: string;
}

function dir(): string {
  return process.env.FAIKKITBOX_VW_APK_DIR ?? "/opt/faikkitbox/data/vw-apk";
}

export function apkPath(): string {
  return join(dir(), "VWWelcome.apk");
}

export function readApkInfo(): VwApkInfo | null {
  try {
    return JSON.parse(readFileSync(join(dir(), "latest.json"), "utf8")) as VwApkInfo;
  } catch {
    return null;
  }
}

export function saveApk(data: Buffer, versionCode: number, versionName: string): VwApkInfo {
  mkdirSync(dir(), { recursive: true });
  // Scriem alături și redenumim: o descărcare în curs nu vede niciodată un fișier pe jumătate.
  const tmp = `${apkPath()}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, apkPath());
  const info: VwApkInfo = {
    versionCode,
    versionName,
    size: data.length,
    uploadedAt: new Date().toISOString(),
  };
  writeFileSync(join(dir(), "latest.json"), JSON.stringify(info));
  return info;
}

export function apkExists(): boolean {
  return existsSync(apkPath()) && statSync(apkPath()).size > 0;
}
