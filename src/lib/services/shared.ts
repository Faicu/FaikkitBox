export type ServiceStatus = "ok" | "error";

export function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function fetchText(
  url: string,
  init?: RequestInit,
  timeoutMs = 8000,
): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 160)}` : ""}`,
      );
    }
    return await res.text();
  } catch (e) {
    throw new Error(`${url} → ${errMsg(e)}`);
  } finally {
    clearTimeout(t);
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 160)}` : ""}`,
      );
    }
    return (await res.json()) as T;
  } catch (e) {
    // Undici hides the real reason under `cause`; surface it.
    throw new Error(`${url} → ${errMsg(e)}`);
  } finally {
    clearTimeout(t);
  }
}

export function errMsg(e: unknown): string {
  if (!e) return "unknown error";
  if (e instanceof Error) {
    const parts = [e.message];
    const cause = (e as { cause?: unknown }).cause;
    if (cause) {
      if (cause instanceof Error) {
        const code = (cause as { code?: string }).code;
        parts.push(`(${cause.message}${code ? ` [${code}]` : ""})`);
      } else {
        parts.push(`(${String(cause)})`);
      }
    }
    return parts.join(" ");
  }
  return String(e);
}
