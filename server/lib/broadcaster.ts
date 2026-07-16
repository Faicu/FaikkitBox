export type DeployEvent = { event: string; data: string };
type Listener = (msg: DeployEvent) => void;

const clients = new Set<Listener>();

export function addDeployListener(fn: Listener) {
  clients.add(fn);
  return () => clients.delete(fn);
}

export function hasActiveClients() {
  return clients.size > 0;
}

export function broadcastDeploy(event: string, data: string) {
  const msg: DeployEvent = { event, data };
  for (const fn of clients) {
    try { fn(msg); } catch { clients.delete(fn); }
  }
}
