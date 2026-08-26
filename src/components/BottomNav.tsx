import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Wrench, Compass, Library } from "lucide-react";
import { adminStatusQuery } from "@/lib/queries";

const publicItems = [{ to: "/", label: "Acasă", icon: LayoutDashboard }] as const;

const authItems = [
  { to: "/", label: "Acasă", icon: LayoutDashboard },
  { to: "/biblioteca", label: "Bibliotecă", icon: Library },
  { to: "/descopera", label: "Descoperă", icon: Compass },
] as const;

const adminItems = [
  { to: "/", label: "Acasă", icon: LayoutDashboard },
  { to: "/biblioteca", label: "Bibliotecă", icon: Library },
  { to: "/descopera", label: "Descoperă", icon: Compass },
  { to: "/tehnic", label: "Tehnic", icon: Wrench },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const admin = useQuery(adminStatusQuery);
  const items = admin.data?.isAdmin
    ? adminItems
    : admin.data?.isAuthenticated
      ? authItems
      : publicItems;
  const activeIndex = items.findIndex((item) => item.to === pathname);
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-card/70 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="relative mx-auto flex max-w-2xl items-stretch justify-around">
        {activeIndex !== -1 && (
          <span
            className="pointer-events-none absolute top-0 h-[2px] rounded-full bg-primary transition-[left] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              left: `calc(${(activeIndex * 100) / items.length}% + 0.75rem)`,
              width: `calc(${100 / items.length}% - 1.5rem)`,
              boxShadow: "0 0 10px color-mix(in oklab, var(--primary) 80%, transparent)",
            }}
          />
        )}
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
