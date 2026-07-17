# FaikkitBox Copilot Instructions

## Commands

- Requires Node.js 22 or later (`node:sqlite` is used for persistence).
- `npm run dev` starts Vite on port 8080.
- `npm run build` produces the Nitro `node-server` bundle in `.output/`; validate every file change with this command.
- `npm run preview` serves the production build locally.
- `npm run lint` runs ESLint across the project. For a focused lint check, use `npx eslint src/routes/qbit.tsx` (substitute the changed file).
- `npm run format` applies Prettier to the whole repository.
- No automated test runner or test files are currently configured, so there is no single-test command.
- Production runs `node .output/server/index.mjs` under the `faikkitbox` systemd service. After a change, build, commit the changed files, push `main`, then run `systemctl restart faikkitbox`.

## Architecture

- This is a standalone Romanian home-server dashboard for Plex, Immich, qBittorrent, host metrics, FileList, TV releases, speed tests, activity, and admin maintenance. It uses React 19, TanStack Start/Router/Query, Vite, Tailwind v4, and Nitro's Node-server preset.
- Files in `src/routes/` are TanStack Router file routes. Each route exports `Route = createFileRoute(...)`; `src/routes/__root.tsx` is the global shell and `PageShell` provides the standard page layout. Route paths and navigation changes are reflected in the generated `src/routeTree.gen.ts`, which must never be edited manually.
- Client pages use TanStack Query with shared query option definitions in `src/lib/queries.ts`. Use those stable query keys and invalidate or update the relevant key after mutations instead of creating duplicate polling/caching rules. Live service data polls at the intervals defined there.
- Browser-to-server operations are TanStack Start `createServerFn` exports in `src/lib/*.functions.ts`, invoked from components with `useServerFn`. Keep HTTP/service integration, privileged commands, filesystem access, and database access inside server-function handlers. Node-only modules are dynamically imported within handlers where necessary so client bundles never import them.
- `server/` contains Nitro-only API routes and startup plugins. `vite.config.ts` registers it through Nitro `scanDirs`; server endpoints such as Plex thumbnails, GitHub webhooks, and deploy SSE belong there rather than in the React routes.
- SQLite is accessed through `getDb()` in `src/lib/db.ts`, with a default production path of `/opt/faikkitbox/data/faikkitbox.db` and an override via `FAIKKITBOX_DB_PATH`. It owns schema creation, JSON migration, and versioned cleanup; add durable dashboard data there rather than adding new JSON stores.
- `src/server.ts` and `src/start.ts` provide the SSR error boundary path. Preserve their conversion of unexpected server errors into the custom HTML error page.

## Repository conventions

- Use the `@/` alias for imports from `src/`.
- All UI is Romanian and the root shell sets `lang="ro"` and dark mode. Keep new user-facing copy in Romanian and maintain the existing dark dashboard treatment.
- Reuse `PageShell`, shared status/error components, and `src/components/ui/` shadcn/Radix primitives. Tailwind semantic colors come from `src/styles.css`; new design tokens need light and dark `oklch` values plus an `@theme inline` mapping.
- Service fetches return typed data with `status: "ok" | "error"` and a user-displayable `error`, allowing pages to render a partial dashboard when an integration is unavailable. Follow this result shape instead of letting a failed integration take down a page.
- Admin-only actions are guarded both by the client-side `adminStatusQuery` UI check and server-side session validation. Preserve the server-side guard for every privileged operation.
- Environment configuration is documented in `.env.example` and `README.md`; never commit `.env` or embed service credentials, API keys, session secrets, or tokens.
- `ActivityType` is the source of truth for activity log and push-notification categories. Add a matching notification title when adding an activity type.
