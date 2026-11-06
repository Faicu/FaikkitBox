import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, RotateCw, X, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { PageShell } from "@/components/PageShell";
import { TehnicSubNav } from "@/components/tehnic/TehnicSubNav";
import { requireAdminBeforeLoad } from "@/lib/auth/admin-route-guard";
import {
  browserAction,
  closeBrowser,
  type BrowserAction,
  type BrowserShot,
} from "@/lib/system/remote-browser.functions";

export const Route = createFileRoute("/browser")({
  beforeLoad: requireAdminBeforeLoad,
  head: () => ({ meta: [{ title: "Browser — Monitor Server" }] }),
  component: BrowserPage,
});

const VIEW_W = 390;
const VIEW_H = 640;

function BrowserPage() {
  const run = useServerFn(browserAction);
  const close = useServerFn(closeBrowser);
  const [shot, setShot] = useState<BrowserShot | null>(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const imgRef = useRef<HTMLImageElement>(null);
  const editing = useRef(false);
  // Acțiunile se execută pe rând; un clic nu trebuie să ajungă înaintea celui dinainte.
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const send = useCallback(
    (action: BrowserAction) => {
      setBusy(true);
      const p = chain.current.then(async () => {
        try {
          const res = await run({ data: action });
          setError(null);
          if (res) {
            setShot(res);
            if (!editing.current) setAddress(res.url);
          } else if (action.type !== "shot") {
            setShot(null);
          }
        } catch (e) {
          setError((e as Error).message);
        }
      });
      chain.current = p;
      void p.finally(() => {
        if (chain.current === p) setBusy(false);
      });
      return p;
    },
    [run],
  );

  // Reîmprospătăm captura cât timp sesiunea e deschisă (pagini care se încarcă, animații).
  useEffect(() => {
    if (!shot) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void send({ type: "shot" });
    }, 2000);
    return () => clearInterval(id);
  }, [!!shot, send]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasSession = !!shot;
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    editing.current = false;
    const url = address.trim();
    if (!url) return;
    void send(
      hasSession ? { type: "goto", url } : { type: "open", width: VIEW_W, height: VIEW_H, url },
    );
  };

  const toViewport = (clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img || !shot) return null;
    const r = img.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * shot.width,
      y: ((clientY - r.top) / r.height) * shot.height,
    };
  };

  // Rotița: handler nativ non-passive, ca să putem opri derularea paginii din jur.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pt = toViewport(e.clientX, e.clientY);
      if (pt) void send({ type: "scroll", ...pt, dy: e.deltaY });
    };
    img.addEventListener("wheel", onWheel, { passive: false });
    return () => img.removeEventListener("wheel", onWheel);
  });

  // Derulare cu degetul pe telefon.
  const touch = useRef<{ y: number; x: number } | null>(null);

  return (
    <PageShell title="Browser" subtitle="Navighează prin conexiunea serverului">
      <div className="mx-auto max-w-3xl space-y-3 px-4 pb-6">
        <TehnicSubNav />

        <form onSubmit={go} className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!hasSession}
            onClick={() => send({ type: "back" })}
            className="rounded-md border p-2 disabled:opacity-40"
            aria-label="Înapoi"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={!hasSession}
            onClick={() => send({ type: "forward" })}
            className="rounded-md border p-2 disabled:opacity-40"
            aria-label="Înainte"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={!hasSession}
            onClick={() => send({ type: "reload" })}
            className="rounded-md border p-2 disabled:opacity-40"
            aria-label="Reîncarcă"
          >
            <RotateCw className="h-4 w-4" />
          </button>
          <input
            value={address}
            onChange={(e) => {
              editing.current = true;
              setAddress(e.target.value);
            }}
            onBlur={() => (editing.current = false)}
            placeholder="emag.ro sau text de căutat"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          />
          {hasSession && (
            <button
              type="button"
              onClick={() => {
                void close().then(() => setShot(null));
              }}
              className="rounded-md border p-2"
              aria-label="Închide sesiunea"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </form>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div
          className="relative mx-auto overflow-hidden rounded-lg border bg-muted"
          style={{ width: "100%", maxWidth: VIEW_W }}
        >
          {shot ? (
            <img
              ref={imgRef}
              src={shot.image}
              alt={shot.title}
              draggable={false}
              className="block w-full select-none"
              style={{ aspectRatio: `${shot.width} / ${shot.height}`, touchAction: "none" }}
              onClick={(e) => {
                const pt = toViewport(e.clientX, e.clientY);
                if (pt) void send({ type: "click", ...pt });
              }}
              onTouchStart={(e) => {
                const t = e.touches[0];
                touch.current = { x: t.clientX, y: t.clientY };
              }}
              onTouchMove={(e) => {
                const t = e.touches[0];
                const prev = touch.current;
                if (!prev) return;
                const dy = prev.y - t.clientY;
                if (Math.abs(dy) < 24) return;
                touch.current = { x: t.clientX, y: t.clientY };
                const pt = toViewport(t.clientX, t.clientY);
                if (pt) void send({ type: "scroll", ...pt, dy: dy * 2 });
              }}
            />
          ) : (
            <div
              className="flex items-center justify-center text-sm text-muted-foreground"
              style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
            >
              {busy ? "Se pornește browserul…" : "Introdu o adresă pentru a începe"}
            </div>
          )}
          {busy && (
            <Loader2 className="absolute right-2 top-2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {hasSession && (
          <form
            className="mx-auto flex max-w-[390px] gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (text) void send({ type: "type", text });
              setText("");
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Text de scris în câmpul selectat"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-md border px-3 text-sm">
              Scrie
            </button>
            <button
              type="button"
              onClick={() => send({ type: "key", key: "Enter" })}
              className="rounded-md border px-3 text-sm"
            >
              Enter
            </button>
            <button
              type="button"
              onClick={() => send({ type: "key", key: "Backspace" })}
              className="rounded-md border px-3 text-sm"
            >
              ⌫
            </button>
          </form>
        )}
        <p className="text-center text-xs text-muted-foreground">
          Sesiunea se închide după 5 minute de inactivitate. Adresele din rețeaua locală sunt
          blocate.
        </p>
      </div>
    </PageShell>
  );
}
