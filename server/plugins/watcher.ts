// Plugin: Watcher — toate sarcinile de fundal, sub un singur tact (registrul în
// src/lib/watcher/tasks.ts, motorul în runner.ts). Nitro nu așteaptă plugin-urile
// async, deci funcția rămâne sincronă.

export default function () {
  void import("../../src/lib/watcher/runner")
    .then(({ startWatcher }) => startWatcher())
    .catch((e) => console.warn("[watcher] Pornirea a eșuat:", e));
}
