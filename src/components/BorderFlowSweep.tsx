// Lumina care alunecă pe bordura unui element cu `border-flow` — pune-o ca
// prim copil al lui, doar cât efectul e activ. Vezi `border-flow` în styles.css.
export function BorderFlowSweep() {
  return (
    <span className="border-flow-sweep" aria-hidden>
      <span />
    </span>
  );
}
