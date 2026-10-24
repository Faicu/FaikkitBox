import { describe, expect, it } from "vitest";

import type { FilelistTorrent } from "@/lib/filelist.functions";
import { checkNonAdminDownload, rememberWizardTorrents } from "./download-quality";

const t = (id: number, name: string) => ({ id, name }) as FilelistTorrent;

describe("descărcări pentru cei care nu sunt admini", () => {
  it("orice calitate din propria căutare; altceva refuzat", () => {
    rememberWizardTorrents(7, [t(1, "Film.2014.1080p.WEB-DL-A"), t(2, "Film.2014.2160p.WEB-DL-B")]);
    expect(checkNonAdminDownload(7, 1).ok).toBe(true);
    expect(checkNonAdminDownload(7, 2).ok).toBe(true);
    // Torrent necăutat de utilizatorul ăsta: refuzat.
    expect(checkNonAdminDownload(8, 1).ok).toBe(false);
    expect(checkNonAdminDownload(7, 99).ok).toBe(false);
  });
});
