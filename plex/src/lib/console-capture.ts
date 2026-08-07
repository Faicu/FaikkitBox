import { logError } from "./error-log";

let capturing = true;

export function withoutConsoleCapture<T>(fn: () => T): T {
  const prev = capturing;
  capturing = false;
  try {
    return fn();
  } finally {
    capturing = prev;
  }
}

export function installConsoleErrorCapture(): void {
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => {
    originalError(...args);
    if (capturing) {
      try {
        logError("server-fn", new Error(args.map(String).join(" ")), "error");
      } catch {
        // ignoră
      }
    }
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    if (capturing) {
      try {
        logError("server-fn", new Error(args.map(String).join(" ")), "warn");
      } catch {
        // ignoră
      }
    }
  };
}
