import { Link, useRouterState } from "@tanstack/react-router";

const items = [
  { to: "/tehnic", label: "Tehnic" },
  { to: "/plex", label: "Plex" },
  { to: "/immich", label: "Immich" },
  { to: "/qbit", label: "qBit" },
  { to: "/sistem", label: "Sistem" },
] as const;

export function TehnicSubNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="inline-flex h-9 w-full items-center justify-between gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-muted-foreground">
      {items.map((item) => {
        const active = pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all ${
              active ? "bg-background text-foreground shadow" : "hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
