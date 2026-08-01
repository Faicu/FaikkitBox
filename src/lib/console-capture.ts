// Captează automat orice console.warn/console.error din tot codul server
// (server functions, SSR, plugin-uri de fundal precum pinned-watcher) și le
// trimite spre logError(), ca să apară în widgetul "Erori aplicație" din
// Tehnic — fără să fie nevoie de un apel logError() manual la fiecare loc
// unde cineva scrie console.warn/error. Instalată o singură dată, la
// pornirea serverului (import cu efect în server.ts).

import { logError } from "./error-log";

let installed = false;
let suppressDepth = 0;

// Folosit de codul care are deja o clasificare mai precisă a sursei (ex.
// "ssr" în loc de generic "server-fn") — evită dubla logare a aceleiași
// erori (una automată, generică, plus una explicită, corect etichetată).
export function withoutConsoleCapture<T>(fn: () => T): T {
  suppressDepth++;
  try {
    return fn();
  } finally {
    suppressDepth--;
  }
}

function toError(args: unknown[]): Error {
  const found = args.find((a) => a instanceof Error) as Error | undefined;
  if (found) return found;
  const message = args
    .map((a) => (typeof a === "string" ? a : safeStringify(a)))
    .join(" ")
    .trim();
  return new Error(message || "(eroare fără mesaj)");
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  } catch {
    return String(v);
  }
}

export function installConsoleErrorCapture(): void {
  if (installed) return;
  installed = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    originalError(...args);
    // Gardă de reintrare: dacă logError() însuși (via getDb()) declanșează
    // un console.warn/error în timpul inițializării DB, nu vrem buclă.
    if (suppressDepth > 0) return;
    suppressDepth++;
    try {
      logError("server-fn", toError(args));
    } finally {
      suppressDepth--;
    }
  };

  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    if (suppressDepth > 0) return;
    suppressDepth++;
    try {
      logError("server-fn", toError(args));
    } finally {
      suppressDepth--;
    }
  };
}
