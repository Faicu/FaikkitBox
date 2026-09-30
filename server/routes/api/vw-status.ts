import { defineEventHandler } from "h3";
import { requireVwToken } from "../../../src/lib/vw/vw-auth";
import { readOdometer, readReminders } from "../../../src/lib/vw/vw-car";
import { readApkInfo } from "../../../src/lib/vw/vw-apk";

// Starea citită de aplicația VW Welcome: kilometrajul, mentenanța (pentru ecran și salutul
// vorbit) și ultimul APK disponibil (pentru actualizarea din aplicație).
export default defineEventHandler((event) => {
  requireVwToken(event);
  const apk = readApkInfo();
  return {
    odometer: readOdometer(),
    reminders: readReminders().map((r) => ({
      title: r.title,
      kmLeft: r.kmLeft,
      daysLeft: r.daysLeft,
      soon: r.soon,
      overdue: r.overdue,
    })),
    apk: apk
      ? { versionCode: apk.versionCode, versionName: apk.versionName, size: apk.size }
      : null,
  };
});
