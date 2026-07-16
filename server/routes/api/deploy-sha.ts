import { defineEventHandler, setHeader } from "h3";

const sha = Date.now().toString();

export default defineEventHandler((event) => {
  setHeader(event, "Content-Type", "text/event-stream");
  setHeader(event, "Cache-Control", "no-cache");
  setHeader(event, "Connection", "keep-alive");
  setHeader(event, "X-Accel-Buffering", "no");

  const body = new ReadableStream({
    start(controller) {
      const send = () => controller.enqueue(`data: ${sha}\n\n`);
      send();
      const id = setInterval(send, 25_000);
      event.node.req.on("close", () => clearInterval(id));
    },
  });

  return new Response(body);
});
