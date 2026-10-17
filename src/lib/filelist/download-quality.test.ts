import { describe, expect, it } from "vitest";

import type { FilelistTorrent } from "@/lib/filelist.functions";
import { checkNonAdminDownload, qualityAllowed, rememberWizardTorrents } from "./download-quality";

const t = (id: number, name: string) => ({ id, name }) as FilelistTorrent;

describe("calitatea pentru cei care nu sunt admini", () => {
  it("1080p mereu; altă calitate doar când titlul n-are 1080p", () => {
    expect(qualityAllowed("Film.2014.1080p.BluRay.x264-GRP", true)).toBe(true);
    expect(qualityAllowed("Film.2014.720p.BluRay.x264-GRP", true)).toBe(false);
    expect(qualityAllowed("Film.2014.2160p.WEB-DL.x265-GRP", true)).toBe(false);
    expect(qualityAllowed("Film.2014.720p.BluRay.x264-GRP", false)).toBe(true);
  });

  it("decide după numele de la Filelist, nu după cererea clientului", () => {
    rememberWizardTorrents(7, [t(1, "Film.2014.1080p.WEB-DL-A"), t(2, "Film.2014.2160p.WEB-DL-B")]);
    expect(checkNonAdminDownload(7, 1).ok).toBe(true);
    expect(checkNonAdminDownload(7, 2).ok).toBe(false);
    // Torrent necăutat de utilizatorul ăsta: refuzat.
    expect(checkNonAdminDownload(8, 1).ok).toBe(false);
    expect(checkNonAdminDownload(7, 99).ok).toBe(false);
  });

  it("fără 1080p pe Filelist, orice calitate găsită", () => {
    rememberWizardTorrents(9, [t(3, "Left.Behind.2014.720p.BluRay.DD5.1.x264-SA89")]);
    expect(checkNonAdminDownload(9, 3).ok).toBe(true);
  });
});
