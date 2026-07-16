import { defineTool } from "@lovable.dev/mcp-js";
import { getVersions } from "@/lib/versions.functions";

export default defineTool({
  name: "service_versions",
  title: "Media stack service versions",
  description:
    "List the current and latest available versions of the tracked self-hosted services (Plex, Immich, qBittorrent), and whether each is up to date.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async () => {
    const versions = await getVersions();
    return {
      content: [{ type: "text", text: JSON.stringify(versions, null, 2) }],
      structuredContent: { services: versions },
    };
  },
});