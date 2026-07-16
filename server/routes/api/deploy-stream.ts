import { defineEventHandler, setHeader } from "h3";
import { addDeployListener } from "../../lib/broadcaster";

export default defineEventHandler((event) => {
  setHeader(event, "Content-Type", "text/event-stream");
  setHeader(event, "Cache-Control", "no-cache");
  setHeader(event, "Connection", "keep-alive");
  setHeader(event, "X-Accel-Buffering", "no");

  const body = new ReadableStream({
    start(controller) {
      const enqueue = (ev: string, data: string) => {
        try { controller.enqueue(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch { remove(); }
      };

      const remove = addDeployListener(({ event: ev, data }) => enqueue(ev, data));
      const ping = setInterval(() => { try { controller.enqueue(": ping\n\n"); } catch { clearInterval(ping); } }, 25_000);

      event.node.req.on("close", () => { remove(); clearInterval(ping); });
    },
  });

  return new Response(body);
});
