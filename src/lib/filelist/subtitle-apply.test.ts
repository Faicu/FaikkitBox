import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// qBittorrent mută fișierul asincron: API-ul răspunde, iar fișierul pleacă
// abia după un timp. Mock-ul imită exact asta.
const renameDelay = { ms: 0, fail: false };
vi.mock("../qbit-client", () => ({
  qbitSetFilePriority: vi.fn(),
  qbitRenameFile: vi.fn(async (_url: string, _hash: string, oldPath: string, newPath: string) => {
    if (renameDelay.fail) throw new Error("qBit renameFile HTTP 409");
    setTimeout(
      () => void rename(join(dir, oldPath), join(dir, newPath)).catch(() => {}),
      renameDelay.ms,
    );
  }),
}));

const { moveAsideTrackedSrt } = await import("./subtitle-apply");

let dir = "";
const ctx = () => ({ qbitUrl: "", torrentHash: "h", qbitUser: "", qbitPass: "", savePath: dir });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "subtitle-apply-"));
  await writeFile(join(dir, "Film.ro.srt"), "1\n00:00:01,000 --> 00:00:02,000\nHello\n");
  renameDelay.fail = false;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("moveAsideTrackedSrt", () => {
  it("așteaptă până pleacă fișierul de la vechea cale", async () => {
    renameDelay.ms = 120;
    expect(await moveAsideTrackedSrt("Film.ro.srt", ctx(), 10, 50)).toBe(true);
  });

  it("false când fișierul tot nu pleacă", async () => {
    renameDelay.ms = 10_000;
    expect(await moveAsideTrackedSrt("Film.ro.srt", ctx(), 3, 20)).toBe(false);
  });

  it("false când qBittorrent refuză redenumirea", async () => {
    renameDelay.fail = true;
    expect(await moveAsideTrackedSrt("Film.ro.srt", ctx(), 3, 20)).toBe(false);
  });
});
