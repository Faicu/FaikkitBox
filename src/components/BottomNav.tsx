import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, PlayCircle, Flame, Images, Download, Cpu } from "lucide-react";

const baseItems = [
  { to: "/", label: "Acasă", icon: LayoutDashboard },
  { to: "/lansari", label: "Lansări", icon: Flame },
  { to: "/plex", label: "Plex", icon: PlayCircle },
  { to: "/immich", label: "Immich", icon: Images },
  { to: "/qbit", label: "qBit", icon: Download },
  { to: "/sistem", label: "Sistem", icon: Cpu },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-card/70 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around">
        {baseItems.map((item) => {
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
                    style={{
                      boxShadow: "0 0 10px color-mix(in oklab, var(--primary) 80%, transparent)",
                    }}
                  />
                )}
                <Icon
                  className={`h-5 w-5 transition-all duration-300 ${active ? "scale-110" : "opacity-80"}`}
                  style={
                    active
                      ? {
                          filter:
                            "drop-shadow(0 0 6px color-mix(in oklab, var(--primary) 70%, transparent))",
                        }
                      : undefined
                  }
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
