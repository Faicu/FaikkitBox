// Iconițele de notificare, disponibile și cu serverul oprit.
//
// `icon` și `badge` nu sunt încorporate în notificare: sunt URL-uri pe care
// browserul le descarcă abia în momentul afișării. Notificarea "Serverul s-a
// oprit" pleacă exact când serverul moare, deci descărcarea lor eșuează și
// Android cade pe fallback — clopoțel în bara de stare, avatar-literă în locul
// logo-ului.
//
// ATENȚIE, aici a greșit prima încercare (f157b95): un handler `fetch` care
// servea cele două căi din cache NU rezolvă nimic. Cererile pentru `icon`,
// `badge` și `image` sunt făcute de browser la nivel intern și NU trec prin
// evenimentul `fetch` al service worker-ului — comportament confirmat pe Chrome
// și Firefox (vezi discuția din specificația Notifications, w3c/ServiceWorker).
// De aceea clopoțelul a reapărut, deși cache-ul era plin.
//
// Singura cale care funcționează: citim imaginile din Cache Storage NOI, în
// handler-ul de push, și le trecem ca `data:` URL. Un data URL nu mai are
// nevoie de rețea, deci nu-l mai poate rata niciun server oprit.
const ASSET_CACHE = "faikkitbox-notif-icons-v2";
const ICON_URL = "/icon-192.png";
const BADGE_URL = "/badge-96.png";
const CACHED_ASSETS = [ICON_URL, BADGE_URL];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(ASSET_CACHE)
      .then((cache) => cache.addAll(CACHED_ASSETS))
      // Dacă serverul e picat chiar la instalare, nu blocăm instalarea —
      // cache-ul se umple la primul push cu serverul pornit (vezi asDataUrl).
      .catch(() => {}),
  );
  // Preluăm controlul imediat: fără asta, o versiune nouă rămâne "waiting"
  // până se închid toate filele PWA, iar schimbările apar cu întârziere de zile.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== ASSET_CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

// btoa vrea un string binar, iar String.fromCharCode(...) pe tot bufferul dintr-o
// bucată depășește limita de argumente pentru icon-192.png (~76 KB). Mergem pe
// felii.
function bytesToBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Întoarce imaginea ca `data:` URL. La orice eșec cade pe calea simplă — adică
// exact comportamentul de dinainte, nu mai rău.
async function asDataUrl(path) {
  try {
    const cache = await caches.open(ASSET_CACHE);
    let res = await cache.match(path);
    if (!res) {
      // Cache gol (instalare făcută cu serverul jos): dacă serverul e sus acum,
      // luăm imaginea și o reținem pentru data viitoare, când poate nu va fi.
      res = await fetch(path);
      if (!res.ok) return path;
      cache.put(path, res.clone()).catch(() => {});
    }
    const type = res.headers.get("content-type") || "image/png";
    const bytes = new Uint8Array(await res.arrayBuffer());
    return `data:${type};base64,${bytesToBase64(bytes)}`;
  } catch {
    return path;
  }
}

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let title = "FaikkitBox";
  let body = "";
  let image;
  let url = "/";
  try {
    const data = event.data.json();
    title = data.title ?? title;
    body = data.body ?? "";
    image = data.image ?? undefined;
    url = data.url ?? "/";
  } catch {
    body = event.data.text();
  }

  event.waitUntil(
    (async () => {
      // `badge` = iconița mică din bara de stare Android. Sistemul o folosește
      // DOAR ca mască: păstrează canalul alfa și umple restul cu alb. Trebuie
      // monocromă, cu fundal transparent — de aceea badge-96.png, nu
      // icon-192.png (care e complet opac și ar ieși un pătrat alb).
      const [icon, badge] = await Promise.all([asDataUrl(ICON_URL), asDataUrl(BADGE_URL)]);
      await self.registration.showNotification(title, {
        body,
        icon,
        badge,
        // Rămâne URL: e posterul titlului, diferit la fiecare notificare, deci
        // nu poate fi precache-uit. Dacă nu se încarcă, Android afișează
        // notificarea fără imaginea mare — restul iconițelor sunt neatinse.
        image,
        vibrate: [100, 50, 100],
        data: { url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(clients.openWindow(url));
});
