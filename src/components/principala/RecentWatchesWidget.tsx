import { useState } from "react";
import { CheckCircle2, Eye, Film } from "lucide-react";

import { UserAvatar } from "@/components/principala/UserAvatar";
import { relativeTime } from "@/components/tehnic/utils";
import { pluralRo } from "@/lib/format";
import type { RecentWatch } from "@/lib/services/recent-watch-types";

// Câte vizionări arată cardul de pe Acasă înainte de "Arată mai multe".
// Serverul trimite tot ce e în fereastra de 30 de zile, deci tăierea e aici,
// unde contează — pe lungimea paginii principale.
const COLLAPSED = 8;
const TZ = "Europe/Bucharest";

// Cronologia vizionărilor din ultimele 30 de zile, grupată pe zile.
export function RecentWatchesWidget({ items }: { items: RecentWatch[] }) {
  const [expanded, setExpanded] = useState(false);
  // Miniaturile vin din Plex prin proxy; dacă item-ul a dispărut între timp,
  // imaginea ar rămâne o casetă goală — ținem minte ce n-a mers și cădem pe
  // iconiță.
  const [broken, setBroken] = useState<Set<string>>(new Set());

  const visible = expanded ? items : items.slice(0, COLLAPSED);
  const groups = groupByDay(visible);

  return (
    <div className="corner-glow corner-glow-emerald rounded-2xl glass-card p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400/25 to-teal-500/10 text-emerald-300 shadow-[0_0_22px_-6px] shadow-emerald-400/60 ring-1 ring-emerald-400/30">
          <Eye className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight">Vizionări recente</div>
          <div className="text-[11px] text-muted-foreground">
            {pluralRo(items.length, "vizionare", "vizionări")} în ultimele 30 de zile
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {groups.map((g) => (
          <div key={g.key}>
            <div
              className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-emerald-300/80 uppercase"
              suppressHydrationWarning
            >
              {g.label}
              <span className="h-px flex-1 bg-gradient-to-r from-emerald-400/30 to-transparent" />
            </div>
            {/* Linia cronologiei; punctele fiecărui rând stau pe ea. */}
            <div className="relative space-y-1.5 pl-4 before:absolute before:top-3 before:bottom-3 before:left-[5px] before:w-px before:bg-gradient-to-b before:from-emerald-400/45 before:to-emerald-400/5">
              {g.items.map(({ item: it, index }) => (
                <WatchRow
                  key={`${it.ratingKey}-${it.username}-${it.viewedAt}`}
                  item={it}
                  // Rândurile apărute la „Arată mai multe” își încep cascada
                  // de la zero, nu după primele opt.
                  delayMs={Math.min((index < COLLAPSED ? index : index - COLLAPSED) * 45, 600)}
                  showImage={!!it.thumbUrl && !broken.has(it.thumbUrl)}
                  onImageError={() => setBroken((prev) => new Set(prev).add(it.thumbUrl!))}
                  today={g.today}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {items.length > COLLAPSED && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 w-full rounded-xl border border-white/5 bg-muted/30 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground active:scale-[0.99]"
        >
          {expanded ? "Arată mai puține" : `Arată mai multe (${items.length - COLLAPSED})`}
        </button>
      )}
    </div>
  );
}

function WatchRow({
  item: it,
  delayMs,
  showImage,
  onImageError,
  today,
}: {
  item: RecentWatch;
  delayMs: number;
  showImage: boolean;
  onImageError: () => void;
  today: boolean;
}) {
  const inProgress =
    !it.completed &&
    it.progressMinutes != null &&
    it.durationMinutes != null &&
    it.durationMinutes > 0;
  const pct = inProgress
    ? Math.min(100, Math.round((it.progressMinutes! / it.durationMinutes!) * 100))
    : 0;
  const ep =
    it.season != null && it.episode != null
      ? `S${String(it.season).padStart(2, "0")}E${String(it.episode).padStart(2, "0")}${
          it.episodeEnd != null ? `-E${String(it.episodeEnd).padStart(2, "0")}` : ""
        }`
      : null;
  const when = new Date(it.viewedAt * 1000);

  return (
    <div
      className="rise-in relative flex items-center gap-3 rounded-xl border border-white/[0.04] bg-muted/30 px-2.5 py-2 transition-[translate,background-color,border-color] duration-200 hover:-translate-y-0.5 hover:border-emerald-400/20 hover:bg-muted/50"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <span
        className={`absolute top-1/2 -left-[15.5px] h-2.5 w-2.5 -translate-y-1/2 rounded-full ring-2 ring-background ${
          inProgress ? "bg-amber-400" : "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60"
        }`}
        aria-hidden
      />
      {showImage ? (
        <img
          src={it.thumbUrl!}
          className="h-14 w-10 shrink-0 rounded-md bg-muted object-cover shadow-md shadow-black/40 ring-1 ring-white/10"
          loading="lazy"
          alt=""
          onError={onImageError}
        />
      ) : (
        <span className="flex h-14 w-10 shrink-0 items-center justify-center rounded-md bg-muted/60 ring-1 ring-white/5">
          <Film className="h-4 w-4 text-amber-400" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm leading-snug font-semibold">{it.show ?? it.title}</div>
        {ep && (
          <div className="truncate text-[11px] text-foreground/70">
            <span className="font-medium text-emerald-300/90">{ep}</span>
            {it.show && it.title ? ` · ${it.title}` : ""}
          </div>
        )}
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <UserAvatar name={it.username} />
          <span className="truncate" suppressHydrationWarning>
            {it.username} ·{" "}
            {today
              ? relativeTime(when.toISOString())
              : when.toLocaleTimeString("ro-RO", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: TZ,
                })}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        {inProgress ? (
          <>
            <span className="text-[10px] text-amber-300/90 tabular-nums">
              {it.progressMinutes}/{it.durationMinutes} min
            </span>
            <span className="h-1 w-12 overflow-hidden rounded-full bg-white/10">
              <span
                className="block h-full rounded-full bg-amber-400/80"
                style={{ width: `${pct}%` }}
              />
            </span>
          </>
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-400/80" aria-label="Terminat" />
        )}
      </div>
    </div>
  );
}

type DayGroup = {
  key: string;
  label: string;
  today: boolean;
  items: Array<{ item: RecentWatch; index: number }>;
};

// Lista vine deja sortată descrescător după oră, deci zilele ies în ordine.
function groupByDay(items: RecentWatch[]): DayGroup[] {
  const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
  const now = new Date();
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(new Date(now.getTime() - 86_400_000));
  const groups: DayGroup[] = [];
  items.forEach((item, index) => {
    const d = new Date(item.viewedAt * 1000);
    const key = dayKey(d);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const label =
        key === todayKey
          ? "Azi"
          : key === yesterdayKey
            ? "Ieri"
            : d.toLocaleDateString("ro-RO", {
                weekday: "long",
                day: "numeric",
                month: "short",
                timeZone: TZ,
              });
      g = { key, label, today: key === todayKey, items: [] };
      groups.push(g);
    }
    g.items.push({ item, index });
  });
  return groups;
}
