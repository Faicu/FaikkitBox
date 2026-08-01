// ---------------------------------------------------------------------------
// Plugin: shutdown rapid și controlat la SIGTERM/SIGINT.
//
// Fără el, oprirea serviciului așteaptă implicit ca Node să dreneze toate
// conexiunile HTTP deschise — inclusiv SSE-ul de auto-reload de la
// server/routes/api/deploy-sha.ts, care rămâne deschis cât timp orice tab de
// browser are dashboard-ul deschis. Asta depășește mereu TimeoutStopSec=5
// din unitatea systemd, care termină procesul cu SIGKILL — un kill necurat,
// fără nicio șansă pentru codul nostru de cleanup (logare "server_stop" etc.)
// să apuce să ruleze la timp / fără garanții.
//
// Aici dăm celorlalte listenere SIGTERM (ex. activity-log.ts, care loghează
// sincron oprirea) o fereastră scurtă să ruleze, apoi forțăm ieșirea explicit
// — controlat de noi, nu de systemd.
// ---------------------------------------------------------------------------

export default function () {
  let shuttingDown = false;

  const forceExit = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    setTimeout(() => process.exit(0), 300);
  };

  process.on("SIGTERM", forceExit);
  process.on("SIGINT", forceExit);
}
