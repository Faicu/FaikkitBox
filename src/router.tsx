import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { routeTree } from "./routeTree.gen";
import { isForbiddenError, isUnauthorizedError } from "./lib/auth/unauthorized";

export const getRouter = () => {
  // Sesiune pierdută în timp ce pagina e deschisă (cookie expirat după 7 zile,
  // tab reluat pe telefon, cont revocat). Garda de rută verifică doar la
  // navigare, deci fără asta pagina ar rămâne pe loc, cu query-uri în eroare.
  // Prima eroare 401 golește cache-ul (datele private încărcate anterior nu
  // mai rămân în memoria tab-ului) și trimite spre login. `redirecting` ține
  // un singur toast/redirect când pică mai multe query-uri deodată.
  let redirecting = false;
  function onAuthError(error: unknown) {
    if (typeof window === "undefined" || redirecting || !isUnauthorizedError(error)) return;
    // Vizitatorul anonim n-avea ce sesiune să piardă — nu-l mutăm pe login.
    const status = queryClient.getQueryData<{ isAuthenticated?: boolean }>(["adminStatus"]);
    if (!status?.isAuthenticated) return;
    redirecting = true;
    toast.warning("Sesiunea a expirat — autentifică-te din nou", { id: "session-expired" });
    // După navigare, ca paginile vechi să fie deja demontate. Nu `clear()`:
    // componentele rămase montate (BottomNav, AppHeader) și-ar păstra ultimul
    // rezultat — meniul de admin rămânea afișat pe pagina de login. Statusul
    // de login se reîncarcă, restul datelor se aruncă.
    void router.navigate({ to: "/login" }).finally(() => {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "adminStatus" });
      void queryClient.invalidateQueries({ queryKey: ["adminStatus"] });
      redirecting = false;
    });
  }

  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError: onAuthError }),
    mutationCache: new MutationCache({ onError: onAuthError }),
    defaultOptions: {
      queries: {
        // Un 401/403 nu se repară reîncercând — ar fi doar cereri în plus.
        retry: (failureCount, error) =>
          !isUnauthorizedError(error) && !isForbiddenError(error) && failureCount < 3,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
