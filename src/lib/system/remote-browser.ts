// ---------------------------------------------------------------------------
// Browser la distanță: un Chromium headless pe server, controlat din pagina
// /browser din Tehnic. Traficul iese prin conexiunea serverului; clientul
// primește doar capturi JPEG. O singură sesiune globală, închisă după
// inactivitate, cu profil temporar (fără cookie-uri persistente).
//
// Chromium vine din playwright-core (browserele sunt în ~/.cache/ms-playwright
// al userului serviciului). Import dinamic, ca modulul să nu încarce nimic la
// pornirea serverului.
// ---------------------------------------------------------------------------

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Browser, BrowserContext, Page } from "playwright-core";

const IDLE_MS = 5 * 60_000;
const NAV_TIMEOUT_MS = 30_000;

export type BrowserShot = {
  image: string; // data:image/jpeg;base64,…
  url: string;
  title: string;
  width: number;
  height: number;
};

type Session = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  timer: NodeJS.Timeout;
};

let session: Session | null = null;
let opening: Promise<Session> | null = null;

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const l = ip.toLowerCase();
    if (l.startsWith("::ffff:")) return isPrivateIp(l.slice(7));
    return (
      l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80")
    );
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

const hostCache = new Map<string, boolean>();

// true dacă hostul duce în rețeaua locală / serverul însuși.
async function isInternalHost(host: string): Promise<boolean> {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true;
  }
  if (isIP(h)) return isPrivateIp(h);
  const cached = hostCache.get(h);
  if (cached !== undefined) return cached;
  let internal: boolean;
  try {
    const addrs = await lookup(h, { all: true });
    internal = addrs.some((a) => isPrivateIp(a.address));
  } catch {
    internal = false; // nerezolvabil: lasă Chromium să dea eroarea lui
  }
  if (hostCache.size > 500) hostCache.clear();
  hostCache.set(h, internal);
  return internal;
}

export function normalizeUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("Adresă goală");
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) {
    throw new Error("Doar adrese http/https");
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  // „emag.ro/ceva” → adresă; text cu spații → căutare
  if (!/\s/.test(raw) && /^[^/]+\.[a-z]{2,}(?::\d+)?(\/|$)/i.test(raw)) return `https://${raw}`;
  if (raw === "localhost" || /^localhost[:/]/.test(raw)) return `http://${raw}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(raw)}`;
}

async function assertAllowed(url: string) {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Doar adrese http/https");
  if (await isInternalHost(u.hostname)) throw new Error("Adresele din rețeaua locală sunt blocate");
}

function arm(s: Session) {
  clearTimeout(s.timer);
  s.timer = setTimeout(() => void closeBrowserSession(), IDLE_MS);
  s.timer.unref();
}

async function launch(width: number, height: number): Promise<Session> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      locale: "ro-RO",
      acceptDownloads: false,
      serviceWorkers: "block",
      // Unele site-uri (eMag) răspund 410 la „HeadlessChrome”: trimitem UA-ul
      // unui Chrome obișnuit, cu aceeași versiune ca browserul lansat.
      userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version().split(".")[0]}.0.0.0 Safari/537.36`,
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    // Fiecare cerere (inclusiv subresursele și redirecturile) trece prin filtrul de rețea locală.
    await context.route("**/*", async (route) => {
      try {
        if (await isInternalHost(new URL(route.request().url()).hostname)) {
          return await route.abort("blockedbyclient");
        }
      } catch {
        // URL ciudat (data:, blob:) — continuă
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    // target=_blank / window.open: rămânem în aceeași filă.
    context.on("page", (popup) => {
      if (popup === page) return;
      void (async () => {
        const target = popup.url();
        await popup.close().catch(() => {});
        if (target && target !== "about:blank") {
          await page.goto(target, { waitUntil: "domcontentloaded" }).catch(() => {});
        }
      })();
    });
    const s: Session = { browser, context, page, timer: setTimeout(() => {}, 0) };
    browser.on("disconnected", () => {
      if (session === s) {
        clearTimeout(s.timer);
        session = null;
      }
    });
    arm(s);
    return s;
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

async function ensure(width: number, height: number): Promise<Session> {
  if (session) {
    arm(session);
    return session;
  }
  opening ??= launch(width, height)
    .then((s) => (session = s))
    .finally(() => {
      opening = null;
    });
  return opening;
}

export async function closeBrowserSession(): Promise<void> {
  const s = session;
  session = null;
  if (!s) return;
  clearTimeout(s.timer);
  await s.browser.close().catch(() => {});
}

export function isBrowserOpen(): boolean {
  return session !== null;
}

async function shot(s: Session): Promise<BrowserShot> {
  const vp = s.page.viewportSize() ?? { width: 0, height: 0 };
  const buf = await s.page.screenshot({ type: "jpeg", quality: 60, timeout: 10_000 });
  return {
    image: `data:image/jpeg;base64,${buf.toString("base64")}`,
    url: s.page.url(),
    title: await s.page.title().catch(() => ""),
    width: vp.width,
    height: vp.height,
  };
}

export type BrowserAction =
  | { type: "open"; width: number; height: number; url?: string }
  | { type: "goto"; url: string }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  | { type: "click"; x: number; y: number }
  | { type: "scroll"; x: number; y: number; dy: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "resize"; width: number; height: number }
  | { type: "shot" };

const num = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(Number(n) || 0)));

export async function runBrowserAction(a: BrowserAction): Promise<BrowserShot | null> {
  if (a.type === "open") {
    const w = Math.max(280, num(a.width, 2000));
    const h = Math.max(280, num(a.height, 2000));
    const s = await ensure(w, h);
    await s.page.setViewportSize({ width: w, height: h });
    if (a.url) {
      const url = normalizeUrl(a.url);
      await assertAllowed(url);
      await s.page.goto(url, { waitUntil: "domcontentloaded" }).catch(navError);
    }
    return shot(s);
  }
  if (!session) return null;
  const s = session;
  arm(s);
  const p = s.page;
  switch (a.type) {
    case "goto": {
      const url = normalizeUrl(a.url);
      await assertAllowed(url);
      await p.goto(url, { waitUntil: "domcontentloaded" }).catch(navError);
      break;
    }
    case "back":
      await p.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
      break;
    case "forward":
      await p.goForward({ waitUntil: "domcontentloaded" }).catch(() => {});
      break;
    case "reload":
      await p.reload({ waitUntil: "domcontentloaded" }).catch(navError);
      break;
    case "click":
      await p.mouse.click(num(a.x, 4000), num(a.y, 4000));
      await p.waitForTimeout(400);
      break;
    case "scroll":
      await p.mouse.move(num(a.x, 4000), num(a.y, 4000));
      await p.mouse.wheel(0, Math.max(-3000, Math.min(3000, Math.round(a.dy) || 0)));
      await p.waitForTimeout(150);
      break;
    case "type":
      await p.keyboard.insertText(a.text.slice(0, 2000));
      break;
    case "key":
      await p.keyboard.press(a.key.slice(0, 40));
      await p.waitForTimeout(300);
      break;
    case "resize":
      await p.setViewportSize({
        width: Math.max(280, num(a.width, 2000)),
        height: Math.max(280, num(a.height, 2000)),
      });
      break;
    case "shot":
      break;
  }
  return shot(s);
}

// Eroare de navigare (DNS, timeout, blocat) → nu aruncăm: pagina de eroare a
// Chromium rămâne vizibilă în captură, iar „aborted" apare la redirecturi normale.
function navError(e: unknown) {
  const msg = (e as Error).message ?? "";
  if (/blockedbyclient/i.test(msg)) throw new Error("Adresa din rețeaua locală este blocată");
}
