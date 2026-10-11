import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "@/lib/activity-log.functions";
import { buildTimeline, plexParts } from "./activity-timeline";

let n = 0;
function e(
  type: ActivityEntry["type"],
  timestamp: string,
  message: string,
  meta?: ActivityEntry["meta"],
): ActivityEntry {
  return { id: String(++n), type, timestamp, message, meta };
}
// Serverul le dă descrescător.
const desc = (...entries: ActivityEntry[]) => entries.reverse();

const ep9 = { user: "ana", title: "Episodul 9", grandparentTitle: "Insula Iubirii" };
const ep10 = { user: "ana", title: "Episodul 10", grandparentTitle: "Insula Iubirii" };

describe("buildTimeline", () => {
  it("comasează începutul și sfârșitul aceleiași vizionări", () => {
    const tl = buildTimeline(
      desc(
        e("plex_watch_start", "2026-10-10T20:00:00Z", "ana: Insula Iubirii — Episodul 9", ep9),
        e(
          "plex_watch_stop",
          "2026-10-10T21:00:00Z",
          "ana: Insula Iubirii — Episodul 9 · 58/180 min (32%)",
          ep9,
        ),
      ),
      [],
    );
    expect(tl).toHaveLength(1);
    const item = tl[0];
    if (item.kind !== "plex") throw new Error(item.kind);
    expect(plexParts(item)).toEqual({
      what: "ana: Insula Iubirii — Episodul 9",
      progress: "58/180 min (32%)",
    });
  });

  it("episodul următor pornit în aceeași secundă nu se încurcă", () => {
    const tl = buildTimeline(
      desc(
        e("plex_watch_start", "2026-10-10T20:00:00Z", "a", ep9),
        e("plex_watch_stop", "2026-10-10T21:00:00Z", "b · 1/2 min (50%)", ep9),
        e("plex_watch_start", "2026-10-10T21:00:00Z", "c", ep10),
      ),
      [],
      Date.parse("2026-10-10T21:30:00Z"),
    );
    expect(
      tl.map((i) => i.kind === "plex" && [i.start?.message, i.stop?.message ?? null, i.ongoing]),
    ).toEqual([
      ["c", null, true],
      ["a", "b · 1/2 min (50%)", false],
    ]);
  });

  it("o vizionare veche fără sfârșit nu mai apare în curs", () => {
    const tl = buildTimeline(
      [e("plex_watch_start", "2026-10-01T20:00:00Z", "a", ep9)],
      [],
      Date.parse("2026-10-10T00:00:00Z"),
    );
    expect(tl[0]).toMatchObject({ kind: "plex", ongoing: false, stop: null });
  });

  it("comasează doar oprirea urmată de pornire prin deploy", () => {
    const tl = buildTimeline(
      desc(
        e("server_stop", "2026-10-10T10:00:00Z", "stop1"),
        e("server_start", "2026-10-10T10:00:10Z", "start1", { deploy: true }),
        e("server_stop", "2026-10-10T11:00:00Z", "stop2"),
        e("server_start", "2026-10-10T11:00:40Z", "start2", { deploy: false }),
        e("server_stop", "2026-10-10T12:00:00Z", "stop3", { unclean: true }),
        e("server_start", "2026-10-10T12:01:00Z", "start3", { deploy: true }),
      ),
      [],
    );
    expect(tl.map((i) => (i.kind === "activity" ? i.entry.message : i.kind))).toEqual([
      "start3",
      "stop3",
      "start2",
      "stop2",
      "deploy",
    ]);
  });
});
