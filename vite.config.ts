import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

// Standalone Vite config (no Lovable dependency). Produces a standard Node
// server build via Nitro's "node-server" preset, ready to run with
// `node .output/server/index.mjs` behind a reverse proxy (nginx) on Ubuntu.
// ---------------------------------------------------------------------------
// Headere de securitate, pe toate răspunsurile.
//
// CSP e deocamdată Report-Only: SSR-ul TanStack Start injectează script și
// stiluri inline, iar o politică strictă aplicată direct ar albi pagina. În
// modul ăsta browserul raportează în consolă ce ar fi blocat, fără să strice
// nimic — când lista de încălcări e curată, `-Report-Only` se poate scoate din
// numele headerului.
//
// Sursele externe reale: postere TMDB, embed-uri YouTube (Descoperă), iar
// `connect-src` acoperă și SSE-ul de pe /api/deploy-sha (same-origin).
// ---------------------------------------------------------------------------
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: https://image.tmdb.org",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src https://www.youtube.com",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = {
  "Content-Security-Policy-Report-Only": CSP,
  // Dublează `frame-ancestors` pentru browserele care încă nu-l respectă —
  // fără el, aplicația poate fi pusă într-un iframe pe un site străin și
  // butoanele de ștergere apăsate prin clickjacking.
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Nimic din aplicație nu are nevoie de ele; le tăiem explicit.
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  // Aplicația se servește prin proxy peste HTTPS. Fără `preload`: e o decizie
  // greu reversibilă, care se ia separat.
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

export default defineConfig(({ command }) => ({
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  server: { host: "::", port: 8080 },
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      server: { entry: "server" },
    }),
    // Only needed at build time; targets a plain Node server instead of Cloudflare Workers.
    // routeRules: paginile HTML (SSR) nu trebuie ținute în cache de browser/PWA,
    // altfel un client (mai ales PWA instalată, fără bară de adresă vizibilă)
    // poate continua să servească un index.html vechi care referă chunk-uri JS
    // deja șterse după un deploy — vezi Jurnalul de Activitate, discuția despre
    // Speedtest/Erori aplicație afișând UI vechi și după refresh manual.
    // Asset-urile din /assets sunt hash-uite pe conținut, deci pot fi cache-uite
    // agresiv fără riscul acesta.
    ...(command === "build"
      ? [
          nitro({
            preset: "node-server",
            scanDirs: ["server"],
            routeRules: {
              "/**": { headers: { "Cache-Control": "no-store", ...SECURITY_HEADERS } },
              "/assets/**": {
                headers: { "Cache-Control": "public, max-age=31536000, immutable" },
              },
              // "private": posterele vin dintr-o bibliotecă Plex privată și
              // ruta e autentificată — doar cache-ul browserului care le-a
              // cerut le poate păstra, nu un proxy comun (nginx/Cloudflare).
              "/api/plex-thumb": { headers: { "Cache-Control": "private, max-age=3600" } },
            },
          }),
        ]
      : []),
    viteReact(),
  ],
}));
