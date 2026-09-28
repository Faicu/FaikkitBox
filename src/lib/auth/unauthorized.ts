// Erorile pe care le aruncă `requireAuth`/`requireAdmin`.
//
// De ce nu `throw new Response("Unauthorized", { status: 401 })`, cum era: un
// `Response` aruncat dintr-o funcție de server ajunge la client marcat
// `x-tss-raw`, iar fetcher-ul TanStack îl întoarce ca REZULTAT reușit, nu ca
// eroare. Query-urile primeau în cache un obiect `Response` în loc de date
// (`a.map is not a function` în Bibliotecă, 28 sept), iar mutațiile intrau pe
// `onSuccess`. Un `Error` e serializat și re-aruncat pe client, deci ajunge
// unde trebuie: starea de eroare a query-ului / `onError` al mutației.
//
// Modul fără importuri de server: îl citește și clientul (router.tsx), ca să
// recunoască erorile după mesaj — o clasă proprie nu supraviețuiește
// serializării, mesajul da.

// Fără sesiune validă (lipsă, expirată, cont revocat) — 401.
export const UNAUTHORIZED_MESSAGE = "Neautorizat";
// Sesiune validă, dar fără rolul cerut (user obișnuit pe o funcție de admin) — 403.
export const FORBIDDEN_MESSAGE = "Acces interzis";

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof Error && error.message === UNAUTHORIZED_MESSAGE;
}

export function isForbiddenError(error: unknown): boolean {
  return error instanceof Error && error.message === FORBIDDEN_MESSAGE;
}
