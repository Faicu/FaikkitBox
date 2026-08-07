import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUser, logoutUser, refreshMyStatus } from "../lib/users.functions";
import {
  searchTitles,
  getTitleDetails,
  checkPlexAvailability,
  addExistingToLibrary,
  startMediaSetup,
  getMyLibrary,
  deleteMyMedia,
  getFullPlexLibrary,
  getWatchers,
} from "../lib/media.functions";
import { usePushNotifications } from "../hooks/use-push-notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/app")({
  component: AppPage,
});

type CurrentUser = { id: number; username: string; role: string; status: string; blocked: number };

function AppPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (!u) navigate({ to: "/login" });
      else setUser(u as CurrentUser);
    });
  }, [navigate]);

  if (user === undefined) return <div className="p-8">Se încarcă...</div>;
  if (!user) return null;
  if (user.status === "pending") return <PendingScreen />;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Salut, {user.username}</h1>
        <div className="flex gap-3">
          {user.role === "admin" && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin">Panou Admin</Link>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => logoutUser().then(() => navigate({ to: "/" }))}>
            Delogare
          </Button>
        </div>
      </header>

      <SearchWidget />
      <NotificationsWidget />
      <MyLibraryWidget />
      <FullLibraryWidget />
    </div>
  );
}

function PendingScreen() {
  const [status, setStatus] = useState("pending");
  const navigate = useNavigate();
  async function refresh() {
    const r = await refreshMyStatus();
    setStatus(r.status);
    if (r.status === "approved") navigate({ to: "/app" });
  }
  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-center">
      <div>
        <p className="text-lg">
          {status === "rejected"
            ? "Cererea ta a fost respinsă."
            : "Se așteaptă aprobarea contului tău de către Faicu..."}
        </p>
        {status !== "rejected" && (
          <Button onClick={refresh} className="mt-4">
            Reîmprospătează
          </Button>
        )}
      </div>
    </div>
  );
}

interface TmdbResult {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  originalTitle: string;
  year: string | null;
  posterUrl: string | null;
}

interface TmdbDetailsFull {
  title: string;
  originalTitle: string;
  imdbId: string | null;
  seasons: Array<{ seasonNumber: number; episodeCount: number; airDate: string | null }>;
}

function NotificationsWidget() {
  const { state, error, subscribe, unsubscribe } = usePushNotifications();
  const subscribed = state === "subscribed";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notificări</CardTitle>
      </CardHeader>
      <CardContent>
        {state === "unsupported" ? (
          <p className="text-sm text-muted-foreground">Browserul tău nu suportă notificări push.</p>
        ) : state === "denied" ? (
          <p className="text-sm text-muted-foreground">
            Notificările sunt blocate din setările browserului — permite-le manual dacă vrei să le
            activezi.
          </p>
        ) : (
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={subscribed}
              disabled={state === "loading"}
              onChange={(e) => (e.target.checked ? subscribe() : unsubscribe())}
            />
            Activează notificările pentru descărcările tale
          </label>
        )}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

// Selecție sezon pentru seriale: un sezon anume, sau "toate" (creează câte o
// cerere per sezon disponibil). Pentru filme nu se afișează.
function SeasonPicker({
  seasons,
  onPick,
}: {
  seasons: TmdbDetailsFull["seasons"];
  onPick: (season: number | "all") => void;
}) {
  return (
    <div className="mt-2 rounded-lg border bg-muted/40 p-3">
      <p className="mb-2 text-sm text-muted-foreground">Alege sezonul:</p>
      <div className="flex flex-wrap gap-2">
        {seasons.map((s) => (
          <Button key={s.seasonNumber} size="sm" variant="secondary" onClick={() => onPick(s.seasonNumber)}>
            Sezon {s.seasonNumber}
          </Button>
        ))}
        <Button size="sm" onClick={() => onPick("all")}>
          Tot serialul
        </Button>
      </div>
    </div>
  );
}

function SearchWidget() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TmdbResult[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingSeasonPick, setPendingSeasonPick] = useState<{
    item: TmdbResult;
    details: TmdbDetailsFull;
  } | null>(null);

  async function doSearch() {
    if (!query.trim()) return;
    const r = await searchTitles({ data: { query } });
    setResults(r as TmdbResult[]);
  }

  async function launchDownload(item: TmdbResult, details: TmdbDetailsFull, season: number | null) {
    await startMediaSetup({
      data: {
        tmdbId: item.id,
        mediaType: item.mediaType,
        title: details.title,
        originalTitle: details.originalTitle,
        imdbId: details.imdbId,
        quality: "1080p",
        season,
      },
    });
  }

  async function selectTitle(item: TmdbResult) {
    setBusy(item.id);
    setMessage(null);
    try {
      const details = (await getTitleDetails({
        data: { tmdbId: item.id, mediaType: item.mediaType },
      })) as TmdbDetailsFull;
      const avail = await checkPlexAvailability({
        data: { title: details.title, originalTitle: details.originalTitle, mediaType: item.mediaType },
      });
      if (avail?.found) {
        await addExistingToLibrary({
          data: { tmdbId: item.id, mediaType: item.mediaType, title: details.title },
        });
        setMessage(`„${details.title}” e deja pe Plex — adăugat în lista ta.`);
        return;
      }
      if (item.mediaType === "tv" && details.seasons.length > 0) {
        setPendingSeasonPick({ item, details });
        return;
      }
      await launchDownload(item, details, null);
      setMessage(`Am pornit descărcarea pentru „${details.title}”.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function pickSeason(season: number | "all") {
    if (!pendingSeasonPick) return;
    const { item, details } = pendingSeasonPick;
    setPendingSeasonPick(null);
    setBusy(item.id);
    setMessage(null);
    try {
      if (season === "all") {
        for (const s of details.seasons) {
          await launchDownload(item, details, s.seasonNumber);
        }
        setMessage(`Am pornit descărcarea pentru toate sezoanele „${details.title}”.`);
      } else {
        await launchDownload(item, details, season);
        setMessage(`Am pornit descărcarea pentru „${details.title}” — sezonul ${season}.`);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Caută un titlu nou</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <Input
            placeholder="Caută film sau serial..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
          />
          <Button onClick={doSearch}>Caută</Button>
        </div>
        {message && <p className="mt-3 text-sm text-sky-400">{message}</p>}
        <ul className="mt-3 space-y-2">
          {results.map((r) => (
            <li key={`${r.mediaType}-${r.id}`} className="rounded-lg bg-muted/40 p-2">
              <div className="flex items-center justify-between gap-3">
                <span>
                  {r.title} {r.year ? `(${r.year})` : ""}{" "}
                  <Badge variant="secondary" className="ml-1">
                    {r.mediaType === "movie" ? "Film" : "Serial"}
                  </Badge>
                </span>
                <Button size="sm" disabled={busy === r.id} onClick={() => selectTitle(r)}>
                  {busy === r.id ? "..." : "Descarcă"}
                </Button>
              </div>
              {pendingSeasonPick?.item.id === r.id && pendingSeasonPick.item.mediaType === r.mediaType && (
                <SeasonPicker seasons={pendingSeasonPick.details.seasons} onPick={pickSeason} />
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

interface OwnershipRow {
  id: number;
  tmdb_id: number;
  media_type: string;
  title: string;
  season: number | null;
  is_owner: number;
  qualities: Array<{ id: number; quality: string; subtitle_source: string | null }>;
}

interface Watcher {
  userId: number;
  username: string;
  lastViewedAt: number;
  views: number;
}

function WatchersDialog({
  item,
  open,
  onOpenChange,
}: {
  item: OwnershipRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [watchers, setWatchers] = useState<Watcher[] | null>(null);

  useEffect(() => {
    if (!item || !open) return;
    setWatchers(null);
    getWatchers({
      data: { tmdbId: item.tmdb_id, mediaType: item.media_type as "movie" | "tv", title: item.title },
    }).then((r) => setWatchers(r as Watcher[]));
  }, [item, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cine a vizionat „{item?.title}”</DialogTitle>
          <DialogDescription>Istoric real de vizionare, preluat din Plex.</DialogDescription>
        </DialogHeader>
        {watchers === null ? (
          <p className="text-sm text-muted-foreground">Se încarcă...</p>
        ) : watchers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nimeni nu a vizionat încă acest titlu.</p>
        ) : (
          <ul className="space-y-2">
            {watchers.map((w) => (
              <li key={w.userId} className="flex items-center justify-between rounded bg-muted p-2 text-sm">
                <span className="font-medium">{w.username}</span>
                <span className="text-xs text-muted-foreground">
                  {w.views} {w.views === 1 ? "vizionare" : "vizionări"} · ultima:{" "}
                  {new Date(w.lastViewedAt * 1000).toLocaleDateString("ro-RO")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MyLibraryWidget() {
  const [items, setItems] = useState<OwnershipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [watchersFor, setWatchersFor] = useState<OwnershipRow | null>(null);

  async function load() {
    const r = await getMyLibrary();
    setItems(r as OwnershipRow[]);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function remove(id: number) {
    await deleteMyMedia({ data: { ownershipId: id } });
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conținutul meu</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Se încarcă...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nu ai încă niciun titlu.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id} className="flex items-center justify-between rounded-lg bg-muted/40 p-2">
                <span>
                  {it.title} {it.season ? `S${it.season}` : ""}{" "}
                  <span className="text-xs text-muted-foreground">
                    {it.qualities.map((q) => q.quality).join(", ")}
                  </span>
                  {!it.is_owner && (
                    <Badge variant="outline" className="ml-2">
                      în listă
                    </Badge>
                  )}
                </span>
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setWatchersFor(it)}>
                    Cine a vizionat
                  </Button>
                  {!!it.is_owner && (
                    <Button size="sm" variant="destructive" onClick={() => remove(it.id)}>
                      Șterge
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <WatchersDialog item={watchersFor} open={!!watchersFor} onOpenChange={(v) => !v && setWatchersFor(null)} />
    </Card>
  );
}

function FullLibraryWidget() {
  const [items, setItems] = useState<Array<{ title: string; type: string; year?: number }>>([]);
  const [q, setQ] = useState("");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const r = await getFullPlexLibrary();
    setItems(r as Array<{ title: string; type: string; year?: number }>);
    setLoaded(true);
  }

  const filtered = items.filter((i) => i.title.toLowerCase().includes(q.toLowerCase())).slice(0, 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Librăria Plex</CardTitle>
      </CardHeader>
      <CardContent>
        {!loaded ? (
          <Button variant="secondary" onClick={load}>
            Încarcă librăria
          </Button>
        ) : (
          <>
            <Input
              className="mb-3"
              placeholder="Caută în librărie..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <ul className="max-h-96 space-y-1 overflow-y-auto text-sm">
              {filtered.map((i, idx) => (
                <li key={idx} className="rounded bg-muted/40 px-2 py-1">
                  {i.title} {i.year ? `(${i.year})` : ""}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
