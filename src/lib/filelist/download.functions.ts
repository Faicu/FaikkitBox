// ---------------------------------------------------------------------------
// Server functions pentru descărcare/subtitrări, separate de download.ts.
//
// download.ts avertiza deja în comentariul lui de sus că "orice import static
// de aici se poate scurge în bundle-ul browserului" — și chiar așa se
// întâmpla. Barrel-ul filelist.functions.ts re-exporta download.ts, iar
// componente client (AddMediaWizard, TitleDetailDrawer, use-download) importau
// din barrel, trăgând tot graful server în bundle-ul public: qbit-client,
// filelist-client, log, media, activity-log, notifications și, prin ele,
// db.ts cu schema SQLite completă — servit cu 200 către orice browser.
//
// Corpul unui handler de server function e eliminat din bundle-ul de client,
// deci importurile dinamice de aici rămân exclusiv pe server.
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";

import type { FilelistDownloadResult } from "./types";
import type { DeleteSubtitleResult } from "./subtitles";
import type { CorrectSubtitleResult, DownloadFilelistParams } from "./download";

export type { CorrectSubtitleResult } from "./download";

export const downloadFilelist = createServerFn({ method: "POST" })
  .validator(
    (data: {
      torrentId: number;
      torrentName: string;
      categoryId: number;
      categoryName?: string;
      size?: number;
      freeleech?: boolean;
      internal?: boolean;
      imdb?: string | null;
      media?: DownloadFilelistParams["media"];
    }) => ({
      ...data,
      torrentId: Number(data.torrentId),
      categoryId: Number(data.categoryId),
      size: data.size !== undefined ? Number(data.size) : undefined,
    }),
  )
  .handler(async ({ data }): Promise<FilelistDownloadResult> => {
    const { requireAuth } = await import("../auth/admin.server");
    const session = await requireAuth();
    const { downloadFilelistCore } = await import("./download");
    return downloadFilelistCore({
      ...data,
      requestedByUserId: session.data.userId ?? null,
    });
  });

export const correctSubtitleForMedia = createServerFn({ method: "POST" })
  .validator((data: { mediaId: number }) => data)
  .handler(async ({ data }): Promise<CorrectSubtitleResult> => {
    const { requireAuth } = await import("../auth/admin.server");
    const session = await requireAuth();
    const { correctSubtitleForMediaCore } = await import("./download");
    return correctSubtitleForMediaCore(session, data);
  });

export const deleteSubtitleForMedia = createServerFn({ method: "POST" })
  .validator((data: { mediaId: number }) => data)
  .handler(async ({ data }): Promise<DeleteSubtitleResult> => {
    const { requireAuth } = await import("../auth/admin.server");
    const session = await requireAuth();
    const { deleteSubtitleForMediaCore } = await import("./download");
    return deleteSubtitleForMediaCore(session, data);
  });
