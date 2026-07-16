import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useEffect } from "react";
import appCss from "../styles.css?url";
import { BottomNav } from "../components/BottomNav";
import { Toaster } from "../components/ui/sonner";
import { useAutoReload } from "../hooks/use-auto-reload";
import { onUpdateDetected } from "../lib/update-signal";
import { toast } from "sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Pagină negăsită</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Pagina pe care o cauți nu există sau a fost mutată.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Înapoi acasă
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Pagina nu s-a încărcat
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A apărut o eroare. Poți încerca reîmprospătarea sau te poți întoarce acasă.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Încearcă din nou
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Înapoi acasă
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "FaikkitBox - Status Monitor" },
      {
        name: "description",
        content: "Statistici Live despre Plex, Immich, qBittorrent și Server",
      },
      { name: "theme-color", content: "#0b0f19" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Server Monitor" },
      { property: "og:title", content: "FaikkitBox - Status Monitor" },
      {
        property: "og:description",
        content: "Statistici Live despre Plex, Immich, qBittorrent și Server",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "FaikkitBox - Status Monitor" },
      {
        name: "twitter:description",
        content: "Statistici Live despre Plex, Immich, qBittorrent și Server",
      },
      {
        property: "og:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/6b2e1074-6ee2-441f-9618-a3f8c71142f9",
      },
      {
        name: "twitter:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/6b2e1074-6ee2-441f-9618-a3f8c71142f9",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ro" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AutoReloadWatcher />
      <Outlet />
      <BottomNav />
      <Toaster richColors closeButton position="top-center" />
    </QueryClientProvider>
  );
}

function AutoReloadWatcher() {
  useAutoReload();

  useEffect(() => {
    return onUpdateDetected(() => {
      let seconds = 5;

      function content(s: number) {
        return (
          <div className="flex flex-col gap-2">
            <span className="text-base font-semibold leading-tight">Actualizare disponibilă</span>
            <span className="text-sm opacity-80">
              Reîncărcare automată în <span className="font-mono font-bold">{s}s</span>
            </span>
            <button
              onClick={() => window.location.reload()}
              className="mt-1 w-full rounded-lg bg-amber-500/20 px-3 py-1.5 text-sm font-semibold text-amber-300 hover:bg-amber-500/30 active:scale-95 transition-all"
            >
              Refresh acum!
            </button>
          </div>
        );
      }

      const toastId = toast.warning(content(seconds), { duration: Infinity, dismissible: false });

      const interval = setInterval(() => {
        seconds -= 1;
        if (seconds <= 0) {
          clearInterval(interval);
          toast.dismiss(toastId);
          window.location.reload();
        } else {
          toast.warning(content(seconds), { id: toastId, duration: Infinity, dismissible: false });
        }
      }, 1000);
    });
  }, []);

  return null;
}
