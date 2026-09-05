import { defineEventHandler, setHeader } from "h3";

// Token de detectare restart, NU un SHA de commit real — se schimbă la fiecare
// pornire a procesului, iar clientul (use-auto-reload.ts) reîncarcă pagina
// când observă că valoarea diferă de cea cu care s-a conectat prima dată.
const serverStartToken = Date.now().toString();

export default defineEventHandler((event) => {
  setHeader(event, "Content-Type", "text/event-stream");
  setHeader(event, "Cache-Control", "no-cache");
  setHeader(event, "Connection", "keep-alive");
  setHeader(event, "X-Accel-Buffering", "no");

  // Curățarea intervalului se leagă de semnalul cererii și de `cancel` al
  // stream-ului, nu de `event.node.req` — `event.node` e opțional în h3 v2
  // (există doar pe runtime-ul Node), deci accesul direct nici nu trecea de
  // type-check odată ce server/ a intrat în tsconfig.
  let id: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (id !== undefined) clearInterval(id);
    id = undefined;
  };

  const body = new ReadableStream({
    start(controller) {
      const send = () => {
        try {
          controller.enqueue(`data: ${serverStartToken}\n\n`);
        } catch {
          // clientul a închis între timp — oprim heartbeat-ul
          stop();
        }
      };
      send();
      id = setInterval(send, 25_000);
      event.req.signal?.addEventListener("abort", stop);
    },
    cancel: stop,
  });

  return new Response(body);
});
