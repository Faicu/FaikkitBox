import { describe, expect, it } from "vitest";

import { classifyTrackers } from "./qbit-tracker-check";

const dht = { url: "** [DHT] **", status: 0, msg: "" };
const t = (status: number, msg = "") => ({ url: "https://tracker.example/announce", status, msg });

describe("classifyTrackers", () => {
  it("ok când un tracker real funcționează", () => {
    expect(classifyTrackers([dht, t(2), t(4, "timeout")]).verdict).toBe("ok");
  });
  it("removed la „Unregistered torrent”", () => {
    const r = classifyTrackers([dht, t(4, "Unregistered torrent"), t(4, "Unregistered torrent")]);
    expect(r).toEqual({ verdict: "removed", message: "Unregistered torrent" });
  });
  it("removed când doar unul dintre trackere zice unregistered", () => {
    expect(classifyTrackers([t(4, "timed out"), t(4, "unregistered")]).verdict).toBe("removed");
  });
  it("down la erori de conexiune", () => {
    expect(classifyTrackers([t(4, "Connection timed out")]).verdict).toBe("down");
  });
  it("unknown cât trackerele nu au răspuns", () => {
    expect(classifyTrackers([dht, t(1)]).verdict).toBe("unknown");
    expect(classifyTrackers([dht]).verdict).toBe("unknown");
  });
});
