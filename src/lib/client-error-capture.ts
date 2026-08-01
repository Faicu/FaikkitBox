// Captează automat orice console.warn/console.error din codul client și le
// trimite spre logClientError(), ca să apară în widgetul "Erori aplicație"
// — fără să fie nevoie de un apel manual la fiecare loc unde cineva scrie
// console.warn/error într-un try/catch. Completează listener-ele
// window.onerror/unhandledrejection din __root.tsx (acelea prind doar
// excepțiile neprinse, nu erorile tratate explicit cu try/catch).

import { logClientError } from "./error-log";

let installed = false;
let suppressDepth = 0;
let restoreFns: (() => void) | null = null;

// Folosit de ErrorComponent, care are deja propriul apel explicit
// logClientError — evită dubla logare a aceleiași erori.
export function withoutClientCapture<T>(fn: () => T): T {
  suppressDepth++;
  try {
    return fn();
  } finally {
    suppressDepth--;
  }
}

function report(args: unknown[]): void {
  if (suppressDepth > 0) return;
  suppressDepth++;
  try {
    const found = args.find((a) => a instanceof Error) as Error | undefined;
    const message =
      found?.message ?? args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
    const stack = found?.stack;
    logClientError({ data: { message, stack } }).catch(() => {});
  } finally {
    suppressDepth--;
  }
}

export function installClientErrorCapture(): () => void {
  if (installed) return () => {};
  installed = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    originalError(...args);
    report(args);
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    report(args);
  };

  restoreFns = () => {
    console.error = originalError;
    console.warn = originalWarn;
    installed = false;
    restoreFns = null;
  };
  return restoreFns;
}
