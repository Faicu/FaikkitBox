import { defineConfig } from "vitest/config";

// Config separat de vite.config.ts intenționat: acolo se încarcă tanstackStart
// și Nitro, care pornesc scanarea rutelor și generarea build-ului de server —
// nimic din toate astea nu e necesar pentru teste pe logică pură, dar tot ar
// rula la fiecare pornire de vitest. Aici rămâne doar alias-ul "@", cât să se
// rezolve importurile din src.
export default defineConfig({
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
  },
  test: {
    // Funcțiile testate sunt pure (parsare de nume, sortări, formatare) —
    // n-au nevoie de DOM, iar mediul node pornește sensibil mai repede.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
