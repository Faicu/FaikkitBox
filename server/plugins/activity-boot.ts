// ---------------------------------------------------------------------------
// Plugin: înregistrează logarea ciclului de viață al serverului (pornire,
// oprire, cauză) la boot-ul Nitro.
//
// Există fiindcă blocul respectiv din src/lib/activity-log.ts rula ca
// side-effect la încărcarea modulului, iar nimic nu importa activity-log la
// pornire — se executa abia la prima cerere HTTP. Măsurat: după un
// `systemctl restart`, jurnalul rămânea gol până când cineva deschidea
// aplicația, moment în care "Serverul a pornit" se scria cu ora greșită (ora
// cererii), cu cauza greșită (os.uptime() era deja mare, deci un reboot real
// apărea ca "pornire manuală"), iar dacă serviciul era oprit înainte de vreo
// cerere, handler-ele de shutdown nici nu apucau să fie înregistrate — oprirea
// nu se loga deloc.
//
// Același tipar ca plex-session-tracker.ts: pluginul e punctul de intrare
// garantat la pornire.
// ---------------------------------------------------------------------------

// Async și AȘTEPTAT de Nitro: dacă am face fire-and-forget, handler-ele de
// shutdown s-ar înregistra abia după ce se rezolvă importul dinamic, iar un
// SIGTERM sosit în fereastra aceea ar găsi oprirea nelogabilă.
export default async function () {
  try {
    const { initServerLifecycleLogging } = await import("../../src/lib/activity-log");
    await initServerLifecycleLogging();
  } catch (e) {
    console.warn("[activity-boot] init eșuat:", e);
  }
}
