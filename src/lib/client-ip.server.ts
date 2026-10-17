// IP-ul real al vizitatorului.
//
// Aplicația primește cererile prin containerul Cloudflare Tunnel, deci
// getRequestIP() dă la toată lumea IP-ul containerului (172.20.0.2) — limita
// de încercări la login era practic comună tuturor, iar IP-urile din istoricul
// de login-uri și din „Erori aplicație" erau toate ale tunelului. Cloudflare
// trimite IP-ul real în antetul CF-Connecting-IP; îl credem DOAR când cererea
// vine chiar din rețeaua Docker a tunelului, altfel oricine l-ar putea
// falsifica trimițând antetul direct pe portul aplicației.

// Rețeaua `cloudflare-tunnel_tunnel` (docker network inspect); IP-ul
// containerului se poate schimba la repornire, rețeaua nu.
const TUNNEL_NETWORK = "172.20.0.0/16";

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function isInCidr(ip: string, cidr: string): boolean {
  const [net, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const a = ipv4ToInt(ip.replace(/^::ffff:/i, ""));
  const b = ipv4ToInt(net);
  if (a == null || b == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

// Pur, pentru teste: IP-ul socket-ului și antetul Cloudflare → IP-ul real.
export function resolveClientIp(
  socketIp: string | undefined,
  cfConnectingIp: string | undefined,
): string {
  const real = cfConnectingIp?.trim();
  if (socketIp && real && isInCidr(socketIp, TUNNEL_NETWORK)) return real;
  return socketIp ?? "unknown";
}

export async function getClientIp(): Promise<string> {
  const { getRequestIP, getRequestHeader } = await import("@tanstack/react-start/server");
  return resolveClientIp(getRequestIP(), getRequestHeader("cf-connecting-ip"));
}
