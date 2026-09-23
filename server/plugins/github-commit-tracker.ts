// La pornirea serverului: sincronizează ultimele commits din GitHub și trimite
// notificări push pentru orice commit nou față de ce avem în DB.
// Acoperă cazul în care webhook-ul a picat în timpul unui restart.

export default function () {
  import("../../src/lib/errors/console-capture").then(({ installConsoleErrorCapture }) =>
    installConsoleErrorCapture(),
  );
  setTimeout(syncOnStart, 6_000);
}

async function syncOnStart() {
  try {
    const { syncCommitsFromGitHub } = await import("../../src/lib/github-commits.server");
    await syncCommitsFromGitHub();
  } catch (err) {
    console.warn("[github-commit-tracker] Sync eșuat la pornire:", err);
  }
}
