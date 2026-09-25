import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Clock3,
  FileCode2,
  Activity,
  CircleHelp,
  RefreshCw,
  Tv,
  Tag,
  Film,
  ChevronDown,
} from "lucide-react";
import { Orb } from "@/components/ui/orb";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { showWatchStatusQuery, wantedMoviesQuery } from "@/lib/queries";
import { relativeTime, formatDateTime } from "./utils";
import { useFlashOnChange } from "@/hooks/use-flash-on-change";
import { nextEpisodeWhen } from "@/components/biblioteca/utils";
import type { PluginInfo, PluginStep } from "./plugins";

// Detaliile unui plugin de fundal. Deschis din lista de pe Tehnic — până acum
// rândurile erau doar informative, fără nimic de apăsat.
export function PluginDetailDrawer({
  plugin,
  lastTs,
  onClose,
}: {
  plugin: PluginInfo | null;
  // Trimis de listă, care oricum îl calculează pentru rând — nu-l recalculăm
  // aici, ca să nu existe două surse pentru același număr.
  lastTs: string | null;
  onClose: () => void;
}) {
  const { data: watch } = useQuery({ ...showWatchStatusQuery, enabled: !!plugin });
  const { data: wanted } = useQuery({ ...wantedMoviesQuery, enabled: !!plugin });
  const wantedMovies = wanted ?? [];
  const isWatcher = plugin?.id === "show-watcher";
  // Explicația pentru „fără dovadă recentă” e aceeași la toate plugin-urile
  // fără timestamp — stă pliată sub iconița de ajutor, nu deschisă mereu.
  const [showWhy, setShowWhy] = useState(false);
  useEffect(() => setShowWhy(false), [plugin?.id]);

  return (
    <Drawer open={!!plugin} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-2 text-left">
          <DrawerTitle className="flex items-center gap-2 text-base">
            {/* Haloul stă pe ::after al containerului (vezi nota din
                styles.css), nu pe iconiță — altfel ar înlocui orice animație
                proprie a ei. */}
            <span className="pulse-glow flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/50">
              {plugin?.icon}
            </span>
            {plugin?.label ?? ""}
            <span className="live-dot ml-auto" />
          </DrawerTitle>
          <DrawerDescription className="text-left">{plugin?.description}</DrawerDescription>
        </DrawerHeader>

        {plugin && (
          <div className="max-h-[65vh] space-y-2.5 overflow-y-auto overscroll-contain px-4 pb-6 stagger-in">
            {plugin.steps ? (
              <PluginSteps key={plugin.id} intro={plugin.details} steps={plugin.steps} />
            ) : (
              <div className="whitespace-pre-line rounded-2xl glass-card p-3 text-xs leading-relaxed text-muted-foreground">
                {plugin.details}
              </div>
            )}

            <div className="rounded-2xl glass-card divide-y divide-border/50 text-xs">
              <Row icon={<Clock3 className="h-3.5 w-3.5" />} label="Când rulează">
                {plugin.cadence}
              </Row>
              <Row
                icon={<Activity className="h-3.5 w-3.5" />}
                label="Ultima activitate"
                flashKey={lastTs}
              >
                {lastTs ? (
                  <span title={formatDateTime(lastTs)}>{relativeTime(lastTs)}</span>
                ) : (
                  // Explicat, nu ascuns: un rând gol l-ar face să pară stricat.
                  <button
                    type="button"
                    onClick={() => setShowWhy((v) => !v)}
                    aria-expanded={showWhy}
                    className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <CircleHelp className="h-3 w-3" /> fără dovadă recentă
                  </button>
                )}
              </Row>
              <Row icon={<FileCode2 className="h-3.5 w-3.5" />} label="Fișier">
                <code className="text-[11px]">server/plugins/{plugin.id}.ts</code>
              </Row>
            </div>

            {!lastTs && showWhy && (
              <div className="rounded-2xl glass-card p-3 text-[11px] leading-relaxed text-muted-foreground">
                Plugin-ul e încărcat, dar nu scrie în jurnal de fiecare dată când rulează — fie
                lucrează doar la pornire, fie nu loghează nimic când n-a găsit nimic de făcut.
                Bulina verde înseamnă „încărcat”, nu „a rulat adineauri”; n-am inventat un timestamp
                din altă sursă doar ca să pară toate la fel.
              </div>
            )}

            {isWatcher && watch && (
              <>
                {/* Numere goale ("Seriale urmărite: 2") nu spun nimic util —
                    întrebarea firească e "care?". Aceleași date, doar
                    desfășurate. */}
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
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {sh.title}
                              </span>
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
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Simetric cu serialele urmărite de deasupra. Aceeași
                    întrebare, alt tip de titlu: „ce aștept și de când?". */}
                <div className="rounded-2xl glass-card p-3 text-xs">
                  <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
                    <Orb state="searching" px={14} /> Filme așteptate
                  </div>
                  {wantedMovies.length === 0 ? (
                    <div className="text-muted-foreground">
                      Niciunul. Pornești urmărirea din wizard, când filmul căutat nu există încă pe
                      Filelist.
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
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl glass-card divide-y divide-border/50 text-xs">
                  <Row
                    icon={<RefreshCw className="h-3.5 w-3.5" />}
                    label="Metadate împrospătate"
                    flashKey={watch.lastMetaRefreshAt}
                  >
                    {watch.lastMetaRefreshAt ? (
                      relativeTime(`${watch.lastMetaRefreshAt.replace(" ", "T")}Z`)
                    ) : (
                      <span className="text-muted-foreground">încă niciodată</span>
                    )}
                  </Row>
                </div>
              </>
            )}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

// Părțile unui plugin cu mai multe responsabilități, ca acordeon cu o singură
// parte deschisă: închis, fiecare rând spune ce face și cât de des; deschis,
// arată toate detaliile. Nimic din explicație nu se pierde, doar se pliază.
function PluginSteps({ intro, steps }: { intro: string; steps: PluginStep[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="overflow-hidden rounded-2xl glass-card text-xs">
      <div className="px-3 pt-3 pb-2 text-muted-foreground">{intro}</div>
      <div className="divide-y divide-border/50 border-t border-border/50">
        {steps.map((step, i) => {
          const isOpen = open === i;
          return (
            <div key={step.title}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/30"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted/50">
                  {step.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{step.title}</span>
                    <span className="shrink-0 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                      {step.cadence}
                    </span>
                  </span>
                  <span className="mt-0.5 block leading-relaxed text-muted-foreground">
                    {step.summary}
                  </span>
                </span>
                <ChevronDown
                  className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
              {/* grid-rows 0fr→1fr: înălțimea se animă fără s-o măsurăm. */}
              <div
                className={`grid transition-[grid-template-rows] duration-200 ease-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
              >
                <div className="overflow-hidden">
                  <ul className="space-y-1.5 pr-3 pb-3 pl-[2.875rem] leading-relaxed text-muted-foreground">
                    {step.points.map((pt) => (
                      <li key={pt} className="relative pl-3">
                        <span className="absolute top-[0.55em] left-0 h-1 w-1 rounded-full bg-muted-foreground/60" />
                        {pt}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// `flashKey`: când valoarea afișată se schimbă (ex. "acum 1h" → "acum 2h",
// după un refetch), valoarea clipește scurt. Animația stă pe cifre, unde
// înseamnă ceva — "asta tocmai s-a actualizat" — nu pe blocuri de text
// statice, unde ar fi doar decor.
function Row({
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

// Aceeași idee ca `Row`, dar pentru o valoare dintr-un rând de text liber.
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
