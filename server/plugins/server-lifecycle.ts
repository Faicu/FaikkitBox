// ---------------------------------------------------------------------------
// Plugin: ciclul de viață al serverului — tot ce ține de pornirea și oprirea
// procesului în sine, nu de vreun serviciu.
//
// 1. Oprire controlată la SIGTERM/SIGINT. Fără ea, oprirea serviciului
//    așteaptă implicit ca Node să dreneze toate conexiunile HTTP deschise —
//    inclusiv SSE-ul de auto-reload de la server/routes/api/deploy-sha.ts,
//    deschis cât timp orice tab are dashboard-ul deschis. Asta depășea mereu
//    TimeoutStopSec=5 din unitatea systemd, care termina procesul cu SIGKILL,
//    fără nicio șansă pentru logarea opririi. Aici dăm celorlalte listenere
//    SIGTERM (logarea sincronă a opririi din activity-log.ts) o fereastră
//    scurtă, apoi ieșim controlat.
//
// 2. Captura erorilor din consolă spre „Erori aplicație” (console-capture.ts).
//    src/server.ts o instalează și el, dar se încarcă abia la prima cerere
//    HTTP — fără pasul de aici, erorile plugin-urilor de la pornire s-ar
//    pierde. Înainte o instalau github-commit-tracker (scos între timp) și
//    plex-session-tracker, fără nicio legătură cu treaba lor.
//
// 3. Logarea pornirii/opririi în jurnal (initServerLifecycleLogging). Blocul
//    rula ca efect secundar de modul, iar nimic nu importa activity-log la
//    pornire — se executa abia la prima cerere HTTP. Măsurat: după un
//    `systemctl restart`, jurnalul rămânea gol până deschidea cineva
//    aplicația, iar atunci „Serverul a pornit” se scria cu ora cererii și cu
//    cauza greșită (os.uptime() era deja mare, deci un reboot real apărea ca
//    „pornire manuală”). Dacă serviciul era oprit înainte de vreo cerere,
//    oprirea nu se loga deloc.
//
// Nitro NU așteaptă plugin-urile async (le apelează într-un for simplu), deci
// funcția e sincronă: oprirea controlată se înregistrează imediat, iar restul
// rulează în fundal, fiecare pas cu try/catch-ul lui — o captură de erori
// eșuată nu trebuie să lase serverul fără logarea pornirii.
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
  // Captura întâi: o eroare apărută la logarea pornirii ajunge astfel și în
  // „Erori aplicație”, nu doar în journalctl.
  void installErrorCapture().then(initLifecycleLogging);
}
