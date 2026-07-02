import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, PlayCircle, Images, Download, Cpu, RefreshCcw } from "lucide-react";
import { adminStatusQuery } from "@/lib/queries";

const baseItems = [
  { to: "/", label: "Acasă", icon: LayoutDashboard },
  { to: "/plex", label: "Plex", icon: PlayCircle },
  { to: "/immich", label: "Immich", icon: Images },
  { to: "/qbit", label: "qBit", icon: Download },
  { to: "/host", label: "Gazdă", icon: Cpu },
] as const;

const adminExtra = { to: "/updates", label: "Update", icon: RefreshCcw } as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const admin = useQuery(adminStatusQuery);
  const items = admin.data?.isAdmin ? [...baseItems, adminExtra] : baseItems;
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur"
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
                className={`flex flex-col items-center gap-1 px-2 py-2.5 text-[11px] transition-colors ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? "" : "opacity-80"}`} />
                <span className="font-medium">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}