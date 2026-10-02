import { describe, it, expect } from "vitest";

import { isClientAbort } from "./error-log";

// Forma exactă din jurnal (Node 26): `Error: aborted` cu code ECONNRESET,
// uneori împachetată de h3 într-o eroare 500 care o poartă ca `cause`.
function abortError() {
  return Object.assign(new Error("aborted"), { code: "ECONNRESET" });
}

describe("isClientAbort", () => {
  it("recunoaște cererea întreruptă de client", () => {
    expect(isClientAbort(abortError())).toBe(true);
  });

  it("recunoaște abortul împachetat ca cause", () => {
    const wrapped = Object.assign(new Error("HTTPError"), { status: 500, cause: abortError() });
    expect(isClientAbort(wrapped)).toBe(true);
  });

  it("nu ascunde alte erori", () => {
    expect(isClientAbort(new Error("aborted"))).toBe(false);
    expect(isClientAbort(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toBe(
      false,
    );
    expect(isClientAbort(new Error("boom"))).toBe(false);
    expect(isClientAbort("aborted")).toBe(false);
    expect(isClientAbort(null)).toBe(false);
  });
});
