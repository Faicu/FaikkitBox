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

// GET cu autentificare automată și un singur retry la 401/403 (SID expirat).
export async function qbitGet(
  url: string,
  path: string,
  user: string,
  pass: string,
): Promise<Response> {
  const cookie = await qbitEnsureCookie(url, user, pass);
  let res = await fetch(`${url}${path}`, { headers: { Cookie: cookie, Referer: url } });
  if (res.status === 401 || res.status === 403) {
    resetQbitCookie();
    const fresh = await qbitLogin(url, user, pass);
    res = await fetch(`${url}${path}`, { headers: { Cookie: fresh, Referer: url } });
  }
  return res;
}

// POST form-urlencoded cu autentificare automată și un singur retry la 401/403.
export async function qbitPostForm(
  url: string,
  path: string,
  user: string,
  pass: string,
  form: Record<string, string>,
): Promise<Response> {
  const body = new URLSearchParams(form);
  const doFetch = (cookie: string) =>
    fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Referer: url,
        Origin: url,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  const cookie = await qbitEnsureCookie(url, user, pass);
  let res = await doFetch(cookie);
  if (res.status === 401 || res.status === 403) {
    resetQbitCookie();
    const fresh = await qbitLogin(url, user, pass);
    res = await doFetch(fresh);
  }
  return res;
}
