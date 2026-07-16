import { defineTool } from "@lovable.dev/mcp-js";
import { getHost } from "@/lib/services.functions";

export default defineTool({
  name: "host_status",
  title: "Server host status",
  description:
    "Read the current status of the Ubuntu host running the stack: hostname, OS, uptime, CPU %, memory %, load average, and per-disk usage. No personal data.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async () => {
    const h = await getHost();
    const summary = {
      status: h.status,
      configured: h.configured,
      hostname: h.hostname,
      os: h.os,
      uptimeSec: h.uptimeSec,
      cpuPercent: h.cpuPercent,
      cpuCores: h.cpuCores,
      loadAvg: h.loadAvg,
      memPercent: h.memPercent,
      memUsedBytes: h.memUsedBytes,
      memTotalBytes: h.memTotalBytes,
      swapPercent: h.swapPercent,
      disks: h.disks,
      error: h.error,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      structuredContent: summary,
    };
  },
});