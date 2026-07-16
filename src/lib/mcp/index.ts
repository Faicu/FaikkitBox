import { defineMcp } from "@lovable.dev/mcp-js";
import hostStatus from "./tools/host-status";
import serviceVersions from "./tools/service-versions";

export default defineMcp({
  name: "faicu-status-mcp",
  title: "Faicu Server Status",
  version: "0.1.0",
  instructions:
    "Read-only public tools that report the health of the Faicu home server: host resource usage and the versions of the tracked media services. No personal data or admin commands are exposed.",
  tools: [hostStatus, serviceVersions],
});