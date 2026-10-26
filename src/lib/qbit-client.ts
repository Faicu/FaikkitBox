// Client qBittorrent unic: cookie SID și o reîncercare la 401/403.

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

// Fetch autentificat; la 401/403 (SID expirat), o reîncercare cu cookie nou.
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

// GET autentificat, cu reîncercare la 401/403.
export function qbitGet(url: string, path: string, user: string, pass: string): Promise<Response> {
  return qbitFetchWithRetry(url, user, pass, (cookie) =>
    fetch(`${url}${path}`, { headers: { Cookie: cookie, Referer: url } }),
  );
}

// POST form-urlencoded, cu reîncercare la 401/403.
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

// Calea reală a conținutului unui torrent (fișierul unic sau folderul) — sursa
// unică pentru „unde e fișierul nostru”: `torrent_name` de pe Filelist diferă
// des de ce a scris qBittorrent pe disc. Ștergerea și legarea la Plex depind
// de ea.
export async function qbitContentPath(
  url: string,
  hash: string,
  user: string,
  pass: string,
): Promise<string | null> {
  try {
    const res = await qbitGet(url, `/api/v2/torrents/info?hashes=${hash}`, user, pass);
    if (!res.ok) return null;
    const info = (await res.json()) as Array<{ content_path?: string }>;
    return info[0]?.content_path ?? null;
  } catch {
    // Torrent șters din qBittorrent — apelantul are o rezervă.
    return null;
  }
}

// Rădăcina unui torrent pe disc — ce dispare la ștergere. Diferă de
// content_path la un fișier unic în folder propriu („Film-GRUP/Film-GRUP.mkv”),
// unde ștergerea după content_path lăsa folderul gol. Rădăcina = primul segment
// comun TUTUROR fișierelor. Fără node:path — modulul ajunge și în client.
export function torrentRootPath(
  savePath: string,
  contentPath: string,
  fileNames: string[],
): string {
  const roots = new Set(fileNames.map((n) => (n.includes("/") ? n.split("/")[0] : "")));
  const [root] = roots;
  if (roots.size !== 1 || !root) return contentPath;
  return `${savePath.replace(/\/$/, "")}/${root}`;
}

export async function qbitTorrentRootPath(
  url: string,
  hash: string,
  user: string,
  pass: string,
): Promise<string | null> {
  try {
    const res = await qbitGet(url, `/api/v2/torrents/info?hashes=${hash}`, user, pass);
    if (!res.ok) return null;
    const info = (await res.json()) as Array<{ content_path?: string; save_path?: string }>;
    const contentPath = info[0]?.content_path ?? null;
    const savePath = info[0]?.save_path;
    if (!contentPath || !savePath) return contentPath;
    const files = await qbitListFiles(url, hash, user, pass);
    return torrentRootPath(
      savePath,
      contentPath,
      files.map((f) => f.name),
    );
  } catch {
    return null;
  }
}

export interface QbitFileInfo {
  index: number; // poziția fișierului în torrent — necesar pentru filePrio
  name: string; // cale relativă în torrent, ex. "Sub/movie.srt"
  size: number;
  progress: number;
  piece_range?: [number, number]; // pentru detectarea suprapunerii de piesă cu alte fișiere
}

// Fișierele unui torrent (media și .srt).
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

// Redenumire în interiorul torrentului — prin API; direct pe disc, qBittorrent
// pierde fișierul și consideră torrentul incomplet.
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

// Exclude (prioritate 0) sau reinclude un fișier. Înainte de a rescrie un .srt
// pe disc: bytes-ii nu mai corespund piesei, iar excluderea împiedică un
// recheck să-l redescarce și seed-ul să trimită bytes greșiți.
export async function qbitSetFilePriority(
  url: string,
  hash: string,
  fileIndex: number,
  priority: 0 | 1 | 6 | 7,
  user: string,
  pass: string,
): Promise<void> {
  const res = await qbitPostForm(url, "/api/v2/torrents/filePrio", user, pass, {
    hash,
    id: String(fileIndex),
    priority: String(priority),
  });
  if (!res.ok) throw new Error(`qBit filePrio HTTP ${res.status}`);
}
