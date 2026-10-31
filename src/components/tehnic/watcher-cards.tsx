import { useQuery } from "@tanstack/react-query";
import { Tv, Tag, Film, History, Captions, CaptionsOff, CheckCircle2 } from "lucide-react";
import { Orb } from "@/components/ui/orb";

import {
  activityLogQuery,
  immichTrackerQuery,
  showWatchStatusQuery,
  subtitleRetryStatusQuery,
  wantedMoviesQuery,
} from "@/lib/queries";
import type { ActivityEntry } from "@/lib/activity-log.functions";
import { relativeTime, formatDateTime } from "./utils";
import { useFlashOnChange } from "@/hooks/use-flash-on-change";
import { nextEpisodeWhen } from "@/components/biblioteca/utils";

// Cardurile proprii ale unor sarcini, sub sarcina deschisă — își cer singure
// datele, doar când sarcina e deschisă.

// Seriale urmărite și filme așteptate — „Seriale și filme” (istoricul e în TaskHistory).
export function ShowWatchCards() {
  const { data: watch } = useQuery(showWatchStatusQuery);
  const { data: wanted } = useQuery(wantedMoviesQuery);
  const wantedMovies = wanted ?? [];
  if (!watch) return null;
  return (
    <>
      {/* Nu „Seriale urmărite: 2”, ci care. */}
      <div className="rounded-2xl glass-card p-3 text-xs">
        <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
          <Orb state="searching" px={14} /> Seriale urmărite
        </div>
        {watch.shows.length === 0 ? (
          <div className="text-muted-foreground">
            Niciunul. Pornești urmărirea din drawer-ul unui serial, în Bibliotecă.
          </div>
        ) : (
          <div className="space-y-1.5 stagger-in">
            {watch.shows.map((sh) => {
              const when = nextEpisodeWhen(sh.nextEpisodeAirDate, sh.nextEpisodeAirstamp);
              return (
                <div key={sh.mediaId} className="rounded-lg bg-muted/40 px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <Tv className="h-3 w-3 shrink-0 text-blue-400" />
                    <span className="min-w-0 flex-1 truncate font-medium">{sh.title}</span>
                    {sh.quality && (
                      <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                        <Tag className="h-2.5 w-2.5" />
                        {sh.quality}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                    {sh.from ? `de după ${sh.from}` : "recuperează tot ce lipsește"}
                    {sh.nextEpisode && when
                      ? ` · urmează ${sh.nextEpisode}, ${when.text}`
                      : " · niciun episod nou anunțat"}
                    {" · "}
                    <FlashValue flashKey={sh.lastCheckedAt}>
                      {sh.lastCheckedAt
                        ? `verificat ${relativeTime(`${sh.lastCheckedAt.replace(" ", "T")}Z`)}`
                        : "încă neverificat"}
                    </FlashValue>
                    <LastResult text={sh.lastResult} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Simetric: „ce aștept și de când?”. */}
      <div className="rounded-2xl glass-card p-3 text-xs">
        <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
          <Orb state="searching" px={14} /> Filme așteptate
        </div>
        {wantedMovies.length === 0 ? (
          <div className="text-muted-foreground">
            Niciunul. Pornești urmărirea din wizard, când filmul căutat nu există încă pe Filelist.
          </div>
        ) : (
          <div className="space-y-1.5 stagger-in">
            {wantedMovies.map((m) => (
              <div key={m.mediaId} className="rounded-lg bg-muted/40 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <Film className="h-3 w-3 shrink-0 text-amber-400" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {m.title}
                    {m.year ? ` (${m.year})` : ""}
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                    <Tag className="h-2.5 w-2.5" />
                    {m.quality}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  <FlashValue flashKey={m.lastCheckedAt}>
                    {m.lastCheckedAt
                      ? `verificat ${relativeTime(`${m.lastCheckedAt.replace(" ", "T")}Z`)}`
                      : "încă neverificat"}
                  </FlashValue>
                  <LastResult text={m.lastResult} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// Ce a găsit ultima verificare a unui titlu urmărit.
function LastResult({ text }: { text: string | null }) {
  if (!text) return null;
  return <span className={text.startsWith("eroare") ? "text-red-300" : ""}>{` · ${text}`}</span>;
}

// Ultimele încărcări Immich din jurnal — sarcina immich-uploads.
export function ImmichUploadsSection() {
  const { data: log } = useQuery(activityLogQuery);
  const entries = Array.isArray(log) ? log : [];
  return (
    <ImmichUploadsCard uploads={entries.filter((e) => e.type === "immich_upload").slice(0, 10)} />
  );
}

// Ultimele încărcări din jurnal, plus cea în desfășurare (scrisă abia la final).
function ImmichUploadsCard({ uploads }: { uploads: ActivityEntry[] }) {
  const { data: tracker } = useQuery(immichTrackerQuery);
  const inProgress = tracker?.inProgress ?? 0;
  return (
    <div className="rounded-2xl glass-card p-3 text-xs">
      <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
        <History className="h-3.5 w-3.5" /> Ultimele încărcări
      </div>
      {inProgress > 0 && (
        <div className="mb-1.5 rounded-lg bg-purple-500/10 px-2 py-1.5 text-[11px] text-purple-300">
          Încărcare în curs — {inProgress} până acum. Intră în jurnal când se termină.
        </div>
      )}
      {uploads.length === 0 ? (
        <div className="text-muted-foreground">
          Nicio încărcare înregistrată încă. Apare aici după următoarea.
        </div>
      ) : (
        <div className="space-y-1.5 stagger-in">
          {uploads.map((e) => (
            <div
              key={e.id}
              className="flex items-start justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1.5"
            >
              <span className="min-w-0 leading-relaxed">{e.message}</span>
              <span
                className="shrink-0 text-[10px] text-muted-foreground"
                title={formatDateTime(e.timestamp)}
              >
                {relativeTime(e.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// `flashKey`: valoarea clipește scurt când se schimbă — pe cifre, unde înseamnă
// „tocmai s-a actualizat”.
export function Row({
  icon,
  label,
  children,
  flashKey,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  flashKey?: string | number | null;
}) {
  const flash = useFlashOnChange(flashKey);
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span
        className={`min-w-0 truncate text-right tabular-nums text-foreground ${flash ? "tick-flash" : ""}`}
      >
        {children}
      </span>
    </div>
  );
}

// Ca `Row`, pentru o valoare dintr-un text liber.
function FlashValue({
  flashKey,
  children,
}: {
  flashKey?: string | number | null;
  children: React.ReactNode;
}) {
  const flash = useFlashOnChange(flashKey);
  return <span className={`tabular-nums ${flash ? "tick-flash" : ""}`}>{children}</span>;
}

// Data în formatul SQLite (UTC) → Date.
const sqliteDate = (v: string) => new Date(`${v.replace(" ", "T")}Z`);
const shortDay = (v: string) =>
  sqliteDate(v).toLocaleDateString("ro-RO", { day: "numeric", month: "short" });

// Reîncercarea subtitrărilor: ce se caută, ce s-a încheiat fără rezultat și ce
// a găsit. O căutare fără rezultat nu scrie în jurnal, deci aici e dovada că
// lucrează.
export function SubtitleRetryCards() {
  const { data } = useQuery(subtitleRetryStatusQuery);
  if (!data) return null;
  const now = Date.now();
  const daysLeft = (until: string) =>
    Math.max(0, Math.ceil((sqliteDate(until).getTime() - now) / (24 * 60 * 60 * 1000)));

  return (
    <>
      <div className="rounded-2xl glass-card p-3 text-xs">
        <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
          <Captions className="h-3.5 w-3.5" /> În căutare acum
          {data.searching.length > 0 && (
            <span className="ml-auto tabular-nums">{data.searching.length}</span>
          )}
        </div>
        {data.searching.length === 0 ? (
          <div className="text-muted-foreground">
            Nimic. Toate titlurile descărcate în ultimele 14 zile au subtitrare română.
          </div>
        ) : (
          <div className="space-y-1.5 stagger-in">
            {data.searching.map((t) => {
              const left = daysLeft(t.until);
              return (
                <div key={t.mediaId} className="rounded-lg bg-muted/40 px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <Captions
                      className={`h-3 w-3 shrink-0 ${t.kind === "approximate" ? "text-amber-400" : "text-teal-400"}`}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        t.kind === "approximate"
                          ? "bg-amber-500/15 text-amber-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {t.kind === "approximate" ? "aproximativă" : "fără subtitrare"}
                    </span>
                  </div>
                  {t.approximateEpisodes.length > 0 && (
                    <div className="mt-0.5 text-[10px] text-amber-400/80">
                      aproximative: {t.approximateEpisodes.join(", ")}
                    </div>
                  )}
                  <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                    până pe {shortDay(t.until)} · {left <= 1 ? "ultima zi" : `mai are ${left} zile`}
                    {" · "}
                    <FlashValue flashKey={t.lastCheckedAt}>
                      {t.lastCheckedAt
                        ? `verificat ${relativeTime(`${t.lastCheckedAt.replace(" ", "T")}Z`)}`
                        : "încă neverificat"}
                    </FlashValue>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {data.ended.length > 0 && (
        <div className="rounded-2xl glass-card p-3 text-xs">
          <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
            <CaptionsOff className="h-3.5 w-3.5" /> Căutare încheiată, fără rezultat
            <span className="ml-auto tabular-nums">{data.ended.length}</span>
          </div>
          <div className="space-y-1.5">
            {data.ended.map((t) => (
              <div key={t.mediaId} className="rounded-lg bg-muted/40 px-2 py-1.5">
                <div className="truncate font-medium">{t.title}</div>
                <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  încheiată pe {shortDay(t.until)} · din Bibliotecă, cu „Corectează subtitrare”
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl glass-card p-3 text-xs">
        <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5" /> Găsite de reîncercare
        </div>
        {data.found.length === 0 ? (
          <div className="text-muted-foreground">
            Niciuna încă. Când găsește una, apare aici și în jurnal, cu notificare.
          </div>
        ) : (
          <div className="space-y-1.5 stagger-in">
            {data.found.map((e) => (
              <div
                key={e.id}
                className="flex items-start justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1.5"
              >
                <span className="min-w-0 leading-relaxed">{e.message}</span>
                <span
                  className="shrink-0 text-[10px] text-muted-foreground"
                  title={formatDateTime(e.timestamp)}
                >
                  {relativeTime(e.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
