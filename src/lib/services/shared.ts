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
    // Undici hides the real reason under `cause`; surface it.
    throw new Error(`${url} → ${errMsg(e)}`);
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
// Cache in-process, partajat între toți clienții.
//
// Paginile de statistici cer datele la interval scurt, iar fiecare tab deschis
// producea un set complet de apeluri proprii: 3 telefoane cu Sistem deschis =
// 3× si.processes() + 3× docker + 3× qBittorrent, în fiecare secundă. Cache-ul
// e pe server, deci N clienți costă cât unul singur.
//
// Cererile concurente pe aceeași cheie primesc aceeași promisiune (nu pornesc
// fiecare propriul fetch), iar la eroare intrarea nu se cachează.
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: Promise<T>;
  expiresAt: number;
  refreshing?: boolean;
}

const asyncCache = new Map<string, CacheEntry<unknown>>();

export interface CachedAsyncOptions {
  /**
   * La expirare, întoarce imediat valoarea veche și reîmprospătează în fundal,
   * în loc să pună apelantul să aștepte recalcularea.
   *
   * Pentru date scumpe și lent-schimbătoare (statistici Docker: 1.7s pentru 8
   * containere) diferența e vizibilă în UI — fără asta, o cerere din 15 dura
   * 2.3s în loc de 50ms, iar pagina Sistem "se poticnea" periodic.
   * Prima cerere, când nu există nimic în cache, tot așteaptă.
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
      // Reîmprospătare în fundal. Dacă eșuează, păstrăm valoarea veche și
      // reîncercăm la următorul apel — mai bine date puțin vechi decât o
      // eroare pentru ceva ce aveam deja.
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
