import { Eye, Film, Image as ImageIcon, Music, PlayCircle, Tv, Users } from "lucide-react";

import { ServicePill } from "@/components/ServicePill";
import { useLiveViewOffsets } from "@/components/principala/useLiveViewOffsets";
import { useCountUp } from "@/hooks/use-count-up";
import { useFlashOnChange } from "@/hooks/use-flash-on-change";
import { UserAvatar } from "@/components/principala/UserAvatar";
import type { PlexData, PlexSession } from "@/lib/services/plex";

// Cardul Plex de pe Acasă: cine se uită acum, cifrele zilei, bibliotecile.
// Drawer-ele „Vizionate azi” / „Utilizatori activi” rămân în pagină — aici
// doar se cer deschise.
export function PlexWidget({
  data,
  isLoading,
  sessions,
  onOpenViews,
  onOpenUsers,
}: {
  data: PlexData | undefined;
  isLoading: boolean;
  sessions: PlexSession[] | undefined;
  onOpenViews: () => void;
  onOpenUsers: () => void;
}) {
  // Ceasul de redare avansează local în fiecare secundă — Plex raportează
  // progresul în trepte de ~10s, deci fără asta cifra "sărea". Vezi hook-ul.
  const liveOffsets = useLiveViewOffsets(sessions);
  const status = isLoading ? "loading" : (data?.status ?? "error");
  const ok = data?.status === "ok";
  const playingCount = ok ? (sessions?.length ?? 0) : 0;
  const live = playingCount > 0;

  return (
    <div
      className={`corner-glow rounded-2xl glass-card p-4 ${live ? "border-flow border-flow-amber" : ""}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400/25 to-orange-500/10 text-amber-300 shadow-[0_0_22px_-6px] shadow-amber-400/60 ring-1 ring-amber-400/30 ${
            live ? "pulse-glow-amber" : ""
          }`}
        >
          <PlayCircle className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight">Plex</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {ok && data.serverName ? data.serverName : "Server media"}
          </div>
        </div>
        {live ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-400/25">
            <span className="live-dot" aria-hidden /> {playingCount} în redare
          </span>
        ) : (
          <ServicePill status={status} />
        )}
      </div>

      {data?.status === "error" && data.error && (
        <p className="mt-2 break-words text-xs text-red-400">{data.error}</p>
      )}

      {isLoading && (
        <div className="mt-4">
          <PlexSkeleton />
        </div>
      )}

      {ok && (
        <div className="mt-4 space-y-3 text-sm">
          {live ? (
            <div className="space-y-2 stagger-in">
              {sessions!.map((s, i) => (
                <SessionRow key={i} session={s} offsetMs={liveOffsets[i] ?? s.viewOffsetMs} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-white/5 bg-muted/30 py-5 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/60 ring-1 ring-border">
                <Users className="h-5 w-5 text-muted-foreground/70" />
              </span>
              <div className="text-sm font-semibold">Nimeni nu se uită acum</div>
              <div className="text-[11px] text-muted-foreground">Serverul e liber</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label="Vizionate azi"
              value={data.episodesToday ?? 0}
              icon={<Eye className="h-4 w-4" />}
              tone="amber"
              onClick={onOpenViews}
            >
              {(data.todayViews ?? []).slice(0, 5).map((v, i) => (
                <div key={i} className="truncate">
                  {v.show ?? v.title}
                </div>
              ))}
            </StatTile>
            <StatTile
              label="Utilizatori activi azi"
              value={data.activeUsersToday ?? 0}
              icon={<Users className="h-4 w-4" />}
              tone="sky"
              onClick={onOpenUsers}
            >
              {(data.activeUsersTodayList ?? []).slice(0, 5).map((u, i) => (
                <div key={i} className="flex items-center justify-between gap-1">
                  <span className="truncate">{u.user}</span>
                  <span className="shrink-0 tabular-nums">{u.count}</span>
                </div>
              ))}
            </StatTile>
          </div>

          {data.libraries.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Biblioteci
                <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
              </div>
              <div className="flex flex-wrap justify-center gap-2 stagger-in">
                {data.libraries.map((lib) => (
                  <LibraryTile key={lib.key} type={lib.type} title={lib.title} count={lib.count} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Rândul „în redare”: fundalul e imaginea titlului, estompată, cu posterul și
// detaliile deasupra. Rândul e copil direct de `stagger-in`, deci nimic din el
// nu pune `animation` pe elementul rădăcină.
function SessionRow({ session: s, offsetMs }: { session: PlexSession; offsetMs: number }) {
  const pct = s.durationMs > 0 ? Math.min(100, Math.round((offsetMs / s.durationMs) * 100)) : 0;
  const isEpisode = !!s.grandparentTitle;
  const paused = s.playerState === "paused";
  const bg = s.artPath ?? s.thumbPath;

  return (
    <div className="relative overflow-hidden rounded-xl ring-1 ring-amber-400/15">
      {bg && (
        <img
          src={thumbSrc(bg, 240)}
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-xl"
          loading="lazy"
          alt=""
          aria-hidden
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/80 to-background/55" />

      <div className="relative space-y-2 p-2.5">
        <div className="flex items-start gap-3">
          {s.thumbPath && (
            <img
              src={thumbSrc(s.thumbPath, 180)}
              className="h-20 w-14 shrink-0 rounded-md bg-muted object-cover shadow-lg shadow-black/50 ring-1 ring-white/10"
              loading="lazy"
              alt=""
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <div className="truncate text-sm font-semibold leading-tight">
                {isEpisode ? s.grandparentTitle : s.title}
              </div>
              {paused ? (
                <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                  ⏸ Pauză
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                  <span className="live-dot" aria-hidden /> Redare
                </span>
              )}
            </div>
            {isEpisode && <div className="truncate text-[11px] text-foreground/70">{s.title}</div>}
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <UserAvatar name={s.user} />
              <span className="truncate">
                {s.user} · {s.player}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  s.playbackMode === "transcode"
                    ? "bg-orange-500/15 text-orange-400"
                    : s.playbackMode === "direct-stream"
                      ? "bg-sky-500/15 text-sky-400"
                      : "bg-emerald-500/15 text-emerald-400"
                }`}
              >
                {playbackLabel(s)}
              </span>
              {transcodeReason(s) && (
                <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-medium text-orange-400">
                  {transcodeReason(s)}
                </span>
              )}
              {s.audioTranscode && (
                <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-medium text-orange-400">
                  {audioTranscodeLabel(s.audioTranscode)}
                </span>
              )}
              {codecLabel(s) && (
                <span className="rounded bg-muted/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {codecLabel(s)}
                </span>
              )}
              {s.burnedSubtitle && !burnIsReason(s) && (
                <span className="rounded bg-muted/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  Subtitrare arsă
                </span>
              )}
            </div>
          </div>
        </div>

        {s.durationMs > 0 && (
          <div className="space-y-1">
            {/* Fără overflow-hidden pe pistă: punctul luminos din capătul barei
                iese jumătate în afara ei. */}
            <div className="relative h-1.5 w-full rounded-full bg-white/10">
              {/* Gradientul curge doar cât rulează — la pauză bara rămâne
                  plată, ca să se vadă dintr-o privire. */}
              <div
                className={`relative h-full rounded-full transition-[width] duration-1000 ease-linear ${
                  paused ? "bg-amber-400/70" : "progress-flow progress-flow-amber"
                }`}
                style={{ width: `${pct}%` }}
              >
                {!paused && pct > 0 && (
                  <span className="absolute top-1/2 right-0 h-2.5 w-2.5 translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-100 shadow-[0_0_10px_2px] shadow-amber-400/70" />
                )}
              </div>
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>{fmtClock(offsetMs)}</span>
              <span className="font-semibold text-amber-300/90">{pct}%</span>
              <span>{fmtClock(s.durationMs)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const STAT_TONES = {
  amber: {
    tile: "from-amber-500/12 hover:border-amber-400/35",
    icon: "bg-amber-400/15 text-amber-300 ring-amber-400/25",
  },
  sky: {
    tile: "from-sky-500/12 hover:border-sky-400/35",
    icon: "bg-sky-400/15 text-sky-300 ring-sky-400/25",
  },
} as const;

// Caseta cu cifra zilei. `translate`/`scale` din Tailwind 4 sunt proprietăți
// separate de `transform`, deci ridicarea la hover merge și pe copiii unui
// `stagger-in`, a căror animație ține `transform` blocat pe `none`.
function StatTile({
  label,
  value,
  icon,
  tone,
  onClick,
  children,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: keyof typeof STAT_TONES;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  const t = STAT_TONES[tone];
  const hasList = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={`rounded-xl border border-white/5 bg-gradient-to-br to-transparent px-3 py-2.5 text-left transition-[translate,scale,border-color,background-color] duration-200 hover:-translate-y-0.5 active:scale-[0.97] ${t.tile}`}
    >
      <div className="flex items-center justify-between gap-2">
        <AnimatedNumber value={value} className="text-3xl leading-none font-bold tabular-nums" />
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ${t.icon}`}
        >
          {icon}
        </span>
      </div>
      <div className="mt-1 text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      {hasList && (
        <div className="mt-2 space-y-0.5 border-t border-border/50 pt-1.5 text-[10px] text-muted-foreground">
          {children}
        </div>
      )}
    </button>
  );
}

const LIBRARY_TONES: Record<string, { tile: string; icon: React.ReactNode }> = {
  movie: {
    tile: "border-amber-400/20 bg-amber-500/[0.07] shadow-amber-500/30 hover:border-amber-400/45",
    icon: <Film className="h-4 w-4 text-amber-400" />,
  },
  show: {
    tile: "border-sky-400/20 bg-sky-500/[0.07] shadow-sky-500/30 hover:border-sky-400/45",
    icon: <Tv className="h-4 w-4 text-sky-400" />,
  },
  artist: {
    tile: "border-purple-400/20 bg-purple-500/[0.07] shadow-purple-500/30 hover:border-purple-400/45",
    icon: <Music className="h-4 w-4 text-purple-400" />,
  },
  photo: {
    tile: "border-emerald-400/20 bg-emerald-500/[0.07] shadow-emerald-500/30 hover:border-emerald-400/45",
    icon: <ImageIcon className="h-4 w-4 text-emerald-400" />,
  },
};
const LIBRARY_FALLBACK = {
  tile: "border-border/60 bg-muted/30 shadow-black/20 hover:border-border",
  icon: <Film className="h-4 w-4 text-muted-foreground" />,
};

function LibraryTile({
  type,
  title,
  count,
}: {
  type: string;
  title: string;
  count: number | null;
}) {
  const t = LIBRARY_TONES[type] ?? LIBRARY_FALLBACK;
  return (
    <div
      className={`flex w-[110px] flex-col items-center gap-1 rounded-xl border py-2.5 text-center shadow-[0_8px_24px_-14px] transition-[translate,border-color] duration-200 hover:-translate-y-0.5 ${t.tile}`}
    >
      {t.icon}
      {count == null ? (
        <div className="text-lg font-bold">—</div>
      ) : (
        <AnimatedNumber value={count} className="text-lg font-bold tabular-nums" />
      )}
      <div className="w-full truncate px-1.5 text-[10px] leading-tight text-muted-foreground">
        {title}
      </div>
    </div>
  );
}

// Cifra urcă animat la afișare și la schimbare; la schimbare face și flash —
// aceeași convenție ca la StatCard.
function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const shown = useCountUp(value);
  const flash = useFlashOnChange(value);
  return <div className={`${className ?? ""} ${flash ? "tick-flash" : ""}`}>{shown}</div>;
}

// Forma cardului Plex cât vine primul răspuns: un rând de redare, cele două
// casete de azi, bibliotecile — ca să nu sară layout-ul la sosirea datelor.
function PlexSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-[6.5rem] skeleton-sweep rounded-xl" />
      <div className="grid grid-cols-2 gap-2">
        <div className="h-20 skeleton-sweep rounded-xl" />
        <div className="h-20 skeleton-sweep rounded-xl" />
      </div>
      <div className="flex justify-center gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-[4.5rem] w-[110px] skeleton-sweep rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// Mărimea cerută Plex-ului (latura mică, px) — vezi THUMB_WIDTHS din
// api/plex-thumb.ts. Posterul de 56px lățime ×3 pentru ecrane dense = 180;
// fundalul e estompat, deci 240 ajunge cu prisosință.
function thumbSrc(path: string, width: 180 | 240): string {
  return `/api/plex-thumb?path=${encodeURIComponent(path)}&w=${width}`;
}

function fmtClock(ms: number): string {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

// „4K → 1080p" când Plex reîncodează, altfel doar calitatea redată.
function qualityLabel(s: PlexSession): string | null {
  const stream = s.streamQuality;
  if (!stream) return s.sourceQuality ?? null;
  if (s.sourceQuality && s.sourceQuality !== stream) return `${s.sourceQuality} → ${stream}`;
  return stream;
}

// Eticheta principală: rezoluția livrată + modul de redare, ca să se vadă
// dintr-o privire că un „1080p" e totuși transcodat („1080p · Transcodare HW").
function playbackLabel(s: PlexSession): string {
  const mode =
    s.playbackMode === "transcode"
      ? `Transcodare${s.hwTranscode ? " HW" : ""}`
      : s.playbackMode === "direct-stream"
        ? "Direct Stream"
        : "Direct Play";
  const quality = qualityLabel(s);
  return quality ? `${quality} · ${mode}` : mode;
}

function videoCodecChanged(s: PlexSession): boolean {
  return (
    !!s.sourceVideoCodec &&
    !!s.videoCodec &&
    prettyCodec(s.sourceVideoCodec) !== prettyCodec(s.videoCodec)
  );
}

// Subtitrarea arsă e singura cauză evidentă când video-ul se re-encodează fără
// să-și schimbe nici rezoluția, nici codecul — Plex n-o poate desena altfel.
function burnIsReason(s: PlexSession): boolean {
  if (s.playbackMode !== "transcode" || !s.burnedSubtitle || videoCodecChanged(s)) return false;
  return !s.sourceQuality || !s.streamQuality || s.sourceQuality === s.streamQuality;
}

// Motivul transcodării video, doar când se poate deduce sigur.
function transcodeReason(s: PlexSession): string | null {
  if (s.playbackMode !== "transcode") return null;
  if (videoCodecChanged(s))
    return `${prettyCodec(s.sourceVideoCodec!)} → ${prettyCodec(s.videoCodec!)}`;
  if (burnIsReason(s)) return "din cauza subtitrării arse";
  return null;
}

// „Audio TrueHD → E-AC3"; doar „Audio convertit" dacă Plex nu dă codecurile.
function audioTranscodeLabel(a: NonNullable<PlexSession["audioTranscode"]>): string {
  if (a.from && a.to) return `Audio ${prettyCodec(a.from)} → ${prettyCodec(a.to)}`;
  return "Audio convertit";
}

function codecLabel(s: PlexSession): string | null {
  const parts: string[] = [];
  if (s.videoCodec) parts.push(prettyCodec(s.videoCodec));
  if (s.audioCodec) {
    const ch = channelsLabel(s.audioChannels);
    parts.push(ch ? `${prettyCodec(s.audioCodec)} ${ch}` : prettyCodec(s.audioCodec));
  }
  if (s.bitrateKbps) parts.push(`${(s.bitrateKbps / 1000).toFixed(1)} Mbps`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function prettyCodec(codec: string): string {
  const c = codec.toLowerCase();
  const known: Record<string, string> = {
    h264: "H.264",
    hevc: "HEVC",
    h265: "HEVC",
    av1: "AV1",
    vp9: "VP9",
    mpeg4: "MPEG-4",
    aac: "AAC",
    eac3: "E-AC3",
    ac3: "AC3",
    dca: "DTS",
    truehd: "TrueHD",
    flac: "FLAC",
    opus: "Opus",
    mp3: "MP3",
  };
  return known[c] ?? codec.toUpperCase();
}

function channelsLabel(channels: number | undefined): string | null {
  if (!channels) return null;
  if (channels === 1) return "Mono";
  if (channels === 2) return "Stereo";
  return `${channels - 1}.1`;
}
