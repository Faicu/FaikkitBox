export type ServiceStatus = "ok" | "error";

export function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

async function fetchOk(url: string, init?: RequestInit, timeoutMs = 8000): Promise<Response> {
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
    return res;
  } catch (e) {
    // Undici ascunde motivul real în `cause` — îl scoatem la suprafață.
    throw new Error(`${url} → ${errMsg(e)}`, { cause: e });
  } finally {
    clearTimeout(t);
  }
}

export async function fetchText(
  url: string,
  init?: RequestInit,
  timeoutMs = 8000,
): Promise<string> {
  const res = await fetchOk(url, init, timeoutMs);
  return res.text();
}

export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const res = await fetchOk(url, init, timeoutMs);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Cache în proces, comun tuturor clienților: fiecare tab cerea propriul set
// complet de date la fiecare secundă. Cererile concurente pe aceeași cheie
// primesc aceeași promisiune; erorile nu se cachează.
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: Promise<T>;
  expiresAt: number;
  refreshing?: boolean;
}

const asyncCache = new Map<string, CacheEntry<unknown>>();

export interface CachedAsyncOptions {
  /**
   * La expirare, valoarea veche imediat și reîmprospătare în fundal — pentru
   * date scumpe și lente (Docker: 1,7s). Doar prima cerere așteaptă.
   */
  staleWhileRevalidate?: boolean;
}

export function cachedAsync<T>(
  key: string,
  ttlMs: number,
  produce: () => Promise<T>,
  options?: CachedAsyncOptions,
): Promise<T> {
  const now = Date.now();
  const hit = asyncCache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;

  if (hit && options?.staleWhileRevalidate) {
    if (!hit.refreshing) {
      hit.refreshing = true;
      // Eșec în fundal: valoarea veche rămâne, se reîncearcă la apelul următor.
      produce()
        .then((fresh) => {
          asyncCache.set(key, { value: Promise.resolve(fresh), expiresAt: Date.now() + ttlMs });
        })
        .catch(() => {
          hit.refreshing = false;
        });
    }
    return hit.value;
  }

  const value = produce().catch((e) => {
    // Nu păstrăm eșecuri în cache — următorul apelant reîncearcă imediat.
    asyncCache.delete(key);
    throw e;
  });
  asyncCache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

// După o schimbare făcută de noi (versiunile după un update), cache-ul minte —
// următorul apelant recalculează.
export function invalidateCached(key: string): void {
  asyncCache.delete(key);
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
