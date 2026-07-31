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

  const body = new ReadableStream({
    start(controller) {
      const send = () => controller.enqueue(`data: ${serverStartToken}\n\n`);
      send();
      const id = setInterval(send, 25_000);
      event.node.req.on("close", () => clearInterval(id));
    },
  });

  return new Response(body);
});
