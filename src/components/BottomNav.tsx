import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, PlayCircle, Flame, Images, Download, Cpu, RefreshCcw, CheckCircle2 } from "lucide-react";
import { adminStatusQuery } from "@/lib/queries";

const baseItems = [
  { to: "/", label: "Acasă", icon: LayoutDashboard },
  { to: "/plex", label: "Plex", icon: PlayCircle },
  { to: "/lansari", label: "Lansări", icon: Flame },
  { to: "/immich", label: "Immich", icon: Images },
  { to: "/qbit", label: "qBit", icon: Download },
  { to: "/host", label: "Gazdă", icon: Cpu },
  { to: "/test", label: "Test", icon: CheckCircle2 },
] as const;

const adminExtra = { to: "/updates", label: "Update", icon: RefreshCcw } as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const admin = useQuery(adminStatusQuery);
  const items = admin.data?.isAdmin ? [...baseItems, adminExtra] : baseItems;
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-card/70 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around">
        {items.map((item) => {
          const active = pathname === item.to;
          const Icon = item.icon;
          return (
            <li key={item.to} className="flex-1">
              <Link
                to={item.to}
                className={`press-tile relative flex flex-col items-center gap-1 px-2 py-2.5 text-[11px] transition-colors ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {active && (
                  <span
                    className="pointer-events-none absolute inset-x-3 top-0 h-[2px] rounded-full bg-primary"
                    style={{ boxShadow: "0 0 10px color-mix(in oklab, var(--primary) 80%, transparent)" }}
                  />
                )}
                <Icon
                  className={`h-5 w-5 transition-all duration-300 ${active ? "scale-110" : "opacity-80"}`}
                  style={active ? { filter: "drop-shadow(0 0 6px color-mix(in oklab, var(--primary) 70%, transparent))" } : undefined}
                />
                <span className="font-medium">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}