import { describe, expect, it } from "vitest";

import { isInCidr, resolveClientIp } from "./client-ip.server";

describe("IP-ul real", () => {
  it("rețeaua tunelului", () => {
    expect(isInCidr("::ffff:172.20.0.2", "172.20.0.0/16")).toBe(true);
    expect(isInCidr("172.20.255.9", "172.20.0.0/16")).toBe(true);
    expect(isInCidr("172.21.0.2", "172.20.0.0/16")).toBe(false);
    expect(isInCidr("::1", "172.20.0.0/16")).toBe(false);
  });

  it("antetul Cloudflare e crezut doar de la tunel", () => {
    expect(resolveClientIp("::ffff:172.20.0.2", "86.120.1.2")).toBe("86.120.1.2");
    expect(resolveClientIp("::ffff:192.168.1.50", "1.2.3.4")).toBe("::ffff:192.168.1.50");
    expect(resolveClientIp("::ffff:172.20.0.2", undefined)).toBe("::ffff:172.20.0.2");
    expect(resolveClientIp(undefined, "1.2.3.4")).toBe("unknown");
  });
});
