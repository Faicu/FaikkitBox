// ---------------------------------------------------------------------------
// Helper: autentificare qBittorrent (cookie SID) — client folosit pentru
// descărcarea torrentelor Filelist. Independent de cache-ul qBittorrent din
// src/lib/services/qbittorrent.ts (acela e pentru monitorizare, nu descărcare).
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
