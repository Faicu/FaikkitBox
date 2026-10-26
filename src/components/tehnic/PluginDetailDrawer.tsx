import { useEffect, useState } from "react";
import { Clock3, FileCode2, Activity, CircleHelp, ChevronDown } from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { relativeTime, formatDateTime } from "./utils";
import { Row } from "./watcher-cards";
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
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

// Părțile unui plugin cu mai multe responsabilități, ca acordeon cu o singură
// parte deschisă: închis, fiecare rând spune ce face și cât de des; deschis,
// arată toate detaliile. Nimic din explicație nu se pierde, doar se pliază.
export function PluginSteps({ intro, steps }: { intro: string; steps: PluginStep[] }) {
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
