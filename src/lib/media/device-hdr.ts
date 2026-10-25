// Indiciul de la întrebarea „Vei putea viziona în HDR?": are dispozitivul pe
// care se uită de obicei utilizatorul ecran HDR?
//
// Plex nu spune asta direct. Avem doar numele și platforma din /devices, plus
// codul de model raportat de aplicație în sesiuni. Regulile de aici sunt deci
// estimări, pe trei niveluri (da / nu / nu știu sigur), fiecare cu sau fără
// „probabil". Două surse le bat: ce a confirmat utilizatorul pentru dispozitiv
// și dovada din sesiuni — un fișier HDR redat direct pe un TV (vezi
// services/device-hdr.server.ts). Prioritatea: confirmare > dovadă > reguli.
//
// Doar un indiciu: nu răspunde și nu preselectează nimic în întrebare.

export type HdrVerdict = "yes" | "no" | "unknown";

// „box" = Chromecast, Fire TV, Android TV, Apple TV — ecranul e televizorul
// legat la el, deci depinde de acela.
export type DeviceCategory = "tv" | "box" | "phone" | "tablet" | "computer" | "other";

export interface DeviceInfo {
  name?: string | null;
  platform?: string | null;
  // Din sesiunile Plex (Player.model / Player.product), dacă s-au văzut.
  model?: string | null;
  product?: string | null;
}

export interface DeviceHdrGuess {
  verdict: HdrVerdict;
  // false = „probabil" (sau, la „unknown", nu contează).
  sure: boolean;
  category: DeviceCategory;
  // Continuarea propoziției „… pe <dispozitiv> — <reason>".
  reason: string;
}

export interface DeviceHdrEvidence {
  // Confirmarea manuală: true = are HDR, false = nu are, null = neconfirmat.
  userAnswer: boolean | null;
  // Ultima redare directă a unui fișier HDR pe dispozitiv (epoch ms).
  hdrDirectAt: number | null;
}

export type DeviceHdrSource = "user" | "observed" | "rules";

export interface ResolvedDeviceHdr extends DeviceHdrGuess {
  source: DeviceHdrSource;
}

// „… al utilizatorului X" e numele implicit dat de Samsung telefoanelor (și
// tabletelor, prinse înainte de TABLET): „A55 al utilizatorului Dragomir".
const PHONE_BRAND =
  /xiaomi|redmi|poco|honor|huawei|samsung|galaxy|\bsm-[a-z]|\b[as]\d{2}\b|al utilizatorului|pixel|oneplus|motorola|\bmoto\b|oppo|realme|vivo|nokia|xperia|nothing phone/i;
const TABLET = /\bi?pad\b|\btab\b|tablet|redmi pad|galaxy tab/i;
const BOX = /\btv\b|shield|fire\s*tv|chromecast|\bbox\b|mi stick|google tv/i;
const BROWSER_OR_PC = /chrome|safari|firefox|edge|opera|windows|macos|osx|linux/i;

export function guessDeviceHdr(d: DeviceInfo): DeviceHdrGuess {
  const name = (d.name ?? "").trim();
  const platform = (d.platform ?? "").trim();
  const model = (d.model ?? "").trim();
  const product = (d.product ?? "").trim();
  const text = `${model} ${name}`;

  if (/webos/i.test(platform) || /^lg\b/i.test(name) || /plex for lg/i.test(product)) {
    return lgGuess(text);
  }
  if (/tizen/i.test(platform) || /plex for samsung/i.test(product)) {
    return samsungGuess(model, name);
  }
  if (/vidaa/i.test(platform)) {
    return unknown("tv", "TV cu sistem Vidaa — nu știu sigur dacă are HDR");
  }
  if (/tvos/i.test(platform) || /apple tv/i.test(name)) {
    return unknown("box", "Apple TV — depinde de televizorul legat la el, nu știu sigur");
  }
  if (/chromecast|roku|android\s*tv|fire\s*os/i.test(platform)) {
    return unknown("box", "depinde de televizorul legat la el, nu știu sigur");
  }
  if (/ios/i.test(platform)) {
    if (/ipad/i.test(name) || /ipad/i.test(model)) return tablet();
    if (/iphone/i.test(name) || /iphone/i.test(model)) return phone();
    return unknown("other", "dispozitiv Apple — nu știu sigur dacă are HDR");
  }
  if (/android/i.test(platform)) {
    // Aplicația își spune varianta în `product`: „Plex for Android (TV)" sau
    // „(Mobile)". Fără sesiune văzută rămâne doar numele dat de utilizator.
    if (/\(tv\)/i.test(product) || BOX.test(name)) {
      return unknown("box", "TV sau box Android — depinde de televizor, nu știu sigur");
    }
    if (TABLET.test(text)) return tablet();
    if (/\(mobile\)/i.test(product) || PHONE_BRAND.test(text)) return phone();
    return unknown("other", "dispozitiv Android — nu știu dacă e telefon sau TV");
  }
  if (BROWSER_OR_PC.test(platform) || BROWSER_OR_PC.test(name)) {
    return {
      verdict: "no",
      sure: false,
      category: "computer",
      reason: "browser sau calculator — laptopurile și monitoarele de obicei nu au HDR",
    };
  }
  return unknown("other", "nu știu sigur dacă are HDR");
}

// LG: „50UN73003LA" → diagonala + U = UHD; „43LM6300" → L = Full HD/HD.
function lgGuess(text: string): DeviceHdrGuess {
  if (/oled|qned|nano/i.test(text) || /\b\d{2}U[A-Z]\d/i.test(text)) {
    return { verdict: "yes", sure: true, category: "tv", reason: "TV LG 4K — are HDR" };
  }
  if (/\b\d{2}L[A-Z]\d/i.test(text)) {
    return {
      verdict: "no",
      sure: false,
      category: "tv",
      reason: "TV LG Full HD — de obicei fără HDR real",
    };
  }
  return unknown("tv", "TV LG — nu știu sigur dacă are HDR");
}

// Samsung: aplicația Plex de Tizen se numește singură „TV <an>", fără model.
// Codul de model vine doar din sesiuni: „UE55RU7102" (RU = 4K 2019),
// „QE55Q60R" (QLED), „UE32N5372" (N + 4 cifre = Full HD/HD).
function samsungGuess(model: string, name: string): DeviceHdrGuess {
  const text = `${model} ${name}`;
  if (/(^|[^A-Z])(QE|QN|QA|GQ)\d{2}/i.test(text)) {
    return { verdict: "yes", sure: true, category: "tv", reason: "Samsung QLED — are HDR" };
  }
  if (/\d{2}(KU|KS|MU|NU|RU|TU|AU|BU|CU|DU)\d{4}/i.test(text)) {
    return { verdict: "yes", sure: true, category: "tv", reason: "TV Samsung 4K — are HDR" };
  }
  if (/\d{2}[JKMNT]\d{4}/i.test(text)) {
    return {
      verdict: "no",
      sure: false,
      category: "tv",
      reason: "TV Samsung Full HD — de obicei fără HDR real",
    };
  }
  const year = Number(/\bTV (20\d{2})\b/i.exec(name)?.[1] ?? 0);
  if (year >= 2017) {
    return {
      verdict: "yes",
      sure: false,
      category: "tv",
      reason: `Samsung din ${year} — majoritatea au HDR, cu excepția modelelor Full HD`,
    };
  }
  if (year === 2016) {
    return unknown("tv", "Samsung din 2016 — doar modelele 4K de top aveau HDR, nu știu sigur");
  }
  if (year > 0) {
    return {
      verdict: "no",
      sure: false,
      category: "tv",
      reason: `Samsung din ${year} — televizoarele de atunci în general nu au HDR`,
    };
  }
  return unknown("tv", "TV Samsung — nu știu sigur dacă are HDR");
}

function phone(): DeviceHdrGuess {
  return {
    verdict: "yes",
    sure: false,
    category: "phone",
    reason: "telefon — cele mai noi au HDR, cele ieftine sau vechi nu întotdeauna",
  };
}

function tablet(): DeviceHdrGuess {
  return unknown("tablet", "tabletă — doar modelele de top au ecran HDR, nu știu sigur");
}

function unknown(category: DeviceCategory, reason: string): DeviceHdrGuess {
  return { verdict: "unknown", sure: false, category, reason };
}

// Confirmarea utilizatorului bate tot; dovada din sesiuni bate regulile, dar
// doar la TV-uri și box-uri. Un telefon sau o tabletă redă direct un fișier
// HDR și fără ecran HDR (îl convertește singur), deci acolo redarea directă nu
// dovedește nimic.
export function resolveDeviceHdr(d: DeviceInfo, ev: DeviceHdrEvidence): ResolvedDeviceHdr {
  const guess = guessDeviceHdr(d);
  if (ev.userAnswer != null) {
    return {
      ...guess,
      verdict: ev.userAnswer ? "yes" : "no",
      sure: true,
      source: "user",
      reason: ev.userAnswer ? "ai confirmat că are HDR" : "ai confirmat că nu are HDR",
    };
  }
  if (ev.hdrDirectAt != null && (guess.category === "tv" || guess.category === "box")) {
    return {
      ...guess,
      verdict: "yes",
      sure: true,
      source: "observed",
      reason: "a mai redat fișiere HDR direct, fără conversie — are HDR",
    };
  }
  return { ...guess, source: "rules" };
}

// Dispozitivul cel mai folosit în fereastră și ultimul folosit, din
// vizionările utilizatorului (orice ordine). null dacă nu are niciuna cu
// dispozitiv cunoscut.
export function pickDevices(
  views: Array<{ deviceId?: number; viewedAt: number }>,
  sinceSec: number,
): { usual: number; last: number } | null {
  const counts = new Map<number, number>();
  let last: { id: number; at: number } | null = null;
  for (const v of views) {
    if (v.deviceId == null) continue;
    if (!last || v.viewedAt > last.at) last = { id: v.deviceId, at: v.viewedAt };
    if (v.viewedAt >= sinceSec) counts.set(v.deviceId, (counts.get(v.deviceId) ?? 0) + 1);
  }
  if (!last) return null;
  let usual = last.id;
  let best = 0;
  for (const [id, n] of counts) {
    if (n > best) {
      best = n;
      usual = id;
    }
  }
  return { usual, last: last.id };
}
