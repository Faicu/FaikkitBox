// Plugin: istoricul de 10 minute al paginii Sistem, eșantionat în fundal de la
// pornire (host-history.server.ts). Nitro nu așteaptă plugin-urile async.

export default function () {
  void import("../../src/lib/services/host-history.server")
    .then(({ startHostHistory }) => startHostHistory())
    .catch((e) => console.warn("[host-history] Pornirea a eșuat:", e));
}
