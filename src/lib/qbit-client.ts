// ---------------------------------------------------------------------------
// Client qBittorrent unic (autentificare cookie SID + fetch cu retry automat
// la 401/403). Folosit atât de fluxul de descărcare Filelist cât și de
// monitorizarea din src/lib/services/qbittorrent.ts.
// ---------------------------------------------------------------------------

let qbitCookie: string | null = null;

export async function qbitLogin(url: string, user: string, pass: string): Promise<string> {
  const body = new URLSearchParams({ username: user, password: pass });
  const res = await fetch(`${url}/api/v2/auth/login`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: url,
      Origin: url,
    },
  });
  if (!res.ok) throw new Error(`qBit login HTTP ${res.status}`);
  const text = await res.text();
  if (text.trim() !== "Ok.") throw new Error(`qBit login respins: ${text}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const sid = setCookie.split(";")[0];
  if (!sid) throw new Error("qBit: cookie SID absent");
  qbitCookie = sid;
  return sid;
}

export async function qbitEnsureCookie(url: string, user: string, pass: string): Promise<string> {
  if (qbitCookie) return qbitCookie;
  return qbitLogin(url, user, pass);
}

export function resetQbitCookie(): void {
  qbitCookie = null;
}

// Rulează un fetch autentificat cu cookie-ul curent și, dacă serverul respinge
// cu 401/403 (SID expirat), face un singur retry cu un cookie proaspăt.
async function qbitFetchWithRetry(
  url: string,
  user: string,
  pass: string,
  doFetch: (cookie: string) => Promise<Response>,
): Promise<Response> {
  const cookie = await qbitEnsureCookie(url, user, pass);
  let res = await doFetch(cookie);
  if (res.status === 401 || res.status === 403) {
    resetQbitCookie();
    const fresh = await qbitLogin(url, user, pass);
    res = await doFetch(fresh);
  }
  return res;
}

// GET cu autentificare automată și un singur retry la 401/403 (SID expirat).
export function qbitGet(url: string, path: string, user: string, pass: string): Promise<Response> {
  return qbitFetchWithRetry(url, user, pass, (cookie) =>
    fetch(`${url}${path}`, { headers: { Cookie: cookie, Referer: url } }),
  );
}

// POST form-urlencoded cu autentificare automată și un singur retry la 401/403.
export function qbitPostForm(
  url: string,
  path: string,
  user: string,
  pass: string,
  form: Record<string, string>,
): Promise<Response> {
  const body = new URLSearchParams(form);
  return qbitFetchWithRetry(url, user, pass, (cookie) =>
    fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Referer: url,
        Origin: url,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }),
  );
}

export interface QbitFileInfo {
  name: string; // cale relativă în torrent, ex. "Sub/movie.srt"
  size: number;
  progress: number;
}

// Listează fișierele unui torrent (pentru a găsi fișierul media + eventuale .srt).
export async function qbitListFiles(
  url: string,
  hash: string,
  user: string,
  pass: string,
): Promise<QbitFileInfo[]> {
  const res = await qbitGet(url, `/api/v2/torrents/files?hash=${hash}`, user, pass);
  if (!res.ok) throw new Error(`qBit torrents/files HTTP ${res.status}`);
  return (await res.json()) as QbitFileInfo[];
}

// Redenumește un fișier din interiorul unui torrent — trebuie făcut prin API,
// nu direct pe disk, altfel qBittorrent pierde evidența fișierului și
// consideră torrentul incomplet.
export async function qbitRenameFile(
  url: string,
  hash: string,
  oldPath: string,
  newPath: string,
  user: string,
  pass: string,
): Promise<void> {
  const res = await qbitPostForm(url, "/api/v2/torrents/renameFile", user, pass, {
    hash,
    oldPath,
    newPath,
  });
  if (!res.ok) throw new Error(`qBit renameFile HTTP ${res.status}`);
}
