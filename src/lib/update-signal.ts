type Listener = () => void;
let listeners: Listener[] = [];

export function onUpdateDetected(fn: Listener) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

export function emitUpdateDetected() {
  listeners.forEach((fn) => fn());
}
