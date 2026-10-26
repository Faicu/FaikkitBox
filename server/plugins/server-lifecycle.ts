// ---------------------------------------------------------------------------
// Plugin: pornirea și oprirea procesului.
//
// 1. Oprire controlată la SIGTERM/SIGINT. Altfel Node aștepta drenarea
//    conexiunilor (inclusiv SSE-ul de auto-reload), depășea TimeoutStopSec=5
//    și systemd dădea SIGKILL, fără logarea opririi.
// 2. Captura erorilor din consolă spre „Erori aplicație” — server.ts o
//    instalează abia la prima cerere HTTP, deci erorile de la pornire s-ar
//    pierde.
// 3. Logarea pornirii/opririi. Ca efect de modul, rula abia la prima cerere
//    HTTP: ora și cauza pornirii ieșeau greșite, iar o oprire înainte de vreo
//    cerere nu se loga deloc.
//
// Nitro nu așteaptă plugin-urile async: oprirea controlată se înregistrează
// imediat, restul rulează în fundal, fiecare pas cu try/catch-ul lui.
// ---------------------------------------------------------------------------

function installFastShutdown(): void {
  let shuttingDown = false;
  const forceExit = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    setTimeout(() => process.exit(0), 300);
  };
  process.on("SIGTERM", forceExit);
  process.on("SIGINT", forceExit);
}

async function installErrorCapture(): Promise<void> {
  try {
    const { installConsoleErrorCapture } = await import("../../src/lib/errors/console-capture");
    installConsoleErrorCapture();
  } catch (e) {
    console.warn("[server-lifecycle] Captura erorilor din consolă a eșuat:", e);
  }
}

async function initLifecycleLogging(): Promise<void> {
  try {
    const { initServerLifecycleLogging } = await import("../../src/lib/activity-log");
    await initServerLifecycleLogging();
  } catch (e) {
    console.warn("[server-lifecycle] Logarea pornirii/opririi a eșuat:", e);
  }
}

export default function () {
  installFastShutdown();
  // Captura întâi, ca o eroare la logarea pornirii să ajungă în „Erori aplicație”.
  void installErrorCapture().then(initLifecycleLogging);
}
