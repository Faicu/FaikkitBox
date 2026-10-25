// Proxy pentru posterele Plex afișate în "cine vizionează acum" (Acasă).
// Există fiindcă imaginile Plex cer PLEX_TOKEN, iar tokenul nu are ce căuta în
// browser — serverul îl adaugă aici, la trecere.
//
// Ruta e autentificată și acceptă o singură formă de cale. Înainte verifica
// doar `path.startsWith("/library/")`, ceea ce era ocolibil: fetch() normalizează
// "/library/../status/sessions" la "/status/sessions" ÎNAINTE de a trimite
// cererea, deci oricine, nelogat, putea folosi ruta ca proxy autentificat către
// întreg API-ul Plex (conturi, sesiuni, chiar /library/parts/... = fișierele
// brute din bibliotecă). De aceea validarea e o listă albă de formă, nu o
// filtrare de "..": blacklist-urile de path traversal se ocolesc, forma nu.

import {
  defineEventHandler,
  getChunkedCookie,
  getQuery,
  setResponseHeader,
  setResponseStatus,
  sendStream,
  unsealSession,
} from "h3";

import {
  sessionConfig,
  isAccountLive,
  type AdminSession,
} from "../../../src/lib/auth/admin.server";

// Exact ce trimite Plex ca `thumb` pe o sesiune: /library/metadata/<id>/thumb/<ts>
// (segmentul final lipsește la unele item-uri, de aici grupul opțional).
const THUMB_PATH = /^\/library\/metadata\/\d+\/[a-z]+(\/\d+)?$/;

// Micșorarea opțională (`w`), făcută de Plex prin /photo/:/transcode: latura
// mică a imaginii ajunge la `w` px (minSize=1 → acoperă un pătrat w×w, deci
// posterul 2:3 iese w lat, fundalul 16:9 iese w înalt). Doar mărimi fixe —
// altfel oricine logat ar putea cere Plex-ului transcodări de orice mărime.
// Fundalul de 253 KB iese ~10 KB la 240.
const THUMB_WIDTHS = new Set([120, 180, 240]);

// Sesiunea se citește DOAR, nu prin getSession(). h3-ul din Nitro (rc.32) e
// mai nou decât cel din TanStack Start (h3-v2, rc.20), care emite și verifică
// cookie-ul de login: getSession() vedea cookie-ul ca „sigiliu vechi” și îl
// rescria în formatul nou, pe care TanStack nu-l mai poate citi — orice
// poster încărcat în „cine vizionează acum” deloga utilizatorul. Citirea
// merge în ambele sensuri; scrierea rămâne exclusiv a TanStack (login/logout).
async function readSession(event: Parameters<typeof getChunkedCookie>[0]) {
  const config = sessionConfig();
  const sealed = getChunkedCookie(event, config.name);
  if (!sealed) return {} as AdminSession;
  const session = await unsealSession(event, config, sealed).catch(() => null);
  return (session?.data ?? {}) as AdminSession;
}

export default defineEventHandler(async (event) => {
  const session = await readSession(event);
  // Aceeași verificare ca `requireAuth`: cookie-ul e valid 7 zile, deci simplul
  // fapt că poartă un userId nu înseamnă că acel cont mai are acces.
  const userId = session.userId;
  if (!userId || !(await isAccountLive(userId, session.sessionVersion))) {
    setResponseStatus(event, 401);
    return "Unauthorized";
  }

  const path = (getQuery(event).path as string) ?? "";
  if (!THUMB_PATH.test(path)) {
    setResponseStatus(event, 400);
    return "Invalid path";
  }

  const wRaw = getQuery(event).w;
  const width = wRaw == null ? null : Number(wRaw);
  if (width != null && !THUMB_WIDTHS.has(width)) {
    setResponseStatus(event, 400);
    return "Invalid size";
  }

  const base = process.env.PLEX_URL?.replace(/\/$/, "");
  const token = process.env.PLEX_TOKEN;
  if (!base || !token) {
    setResponseStatus(event, 503);
    return "Plex not configured";
  }

  try {
    // Tokenul merge pe header, nu în query string — altfel ajunge în logurile
    // de acces ale Plex-ului la fiecare poster încărcat.
    const target =
      width == null
        ? `${base}${path}`
        : `${base}/photo/:/transcode?${new URLSearchParams({
            width: String(width),
            height: String(width),
            minSize: "1",
            upscale: "0",
            url: path,
          })}`;
    const res = await fetch(target, { headers: { "X-Plex-Token": token } });
    if (!res.ok) {
      setResponseStatus(event, res.status);
      return "Upstream error";
    }

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    setResponseHeader(event, "Content-Type", contentType);
    // "private": conținutul e dintr-o bibliotecă privată, doar cache-ul
    // browserului care l-a cerut are voie să-l păstreze, nu un proxy comun.
    setResponseHeader(event, "Cache-Control", "private, max-age=3600");

    return sendStream(event, res.body as ReadableStream);
  } catch {
    setResponseStatus(event, 502);
    return "Fetch error";
  }
});
