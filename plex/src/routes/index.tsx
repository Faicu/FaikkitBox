import { createFileRoute, Link } from "@tanstack/react-router";
import { PosterBackground } from "@/components/poster-background";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 px-4 text-center">
      <PosterBackground />
      <div className="glass-card flex flex-col items-center gap-6 rounded-2xl px-8 py-12 shadow-2xl">
        <h1 className="bg-gradient-to-br from-sky-300 via-sky-400 to-indigo-400 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent sm:text-5xl">
          FaikkitBox Plex
        </h1>
        <p className="max-w-md text-balance text-neutral-300">
          Caută, descarcă și gestionează propriul conținut pe Plex — self-service, fără să mă
          deranjezi de fiecare dată.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            to="/login"
            className="rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 px-6 py-2.5 font-medium text-white shadow-lg shadow-sky-900/40 transition hover:scale-105 hover:shadow-sky-800/50"
          >
            Client Existent
          </Link>
          <Link
            to="/register"
            className="rounded-full border border-neutral-700 bg-neutral-900/60 px-6 py-2.5 font-medium text-neutral-200 transition hover:scale-105 hover:bg-neutral-800"
          >
            Client Nou
          </Link>
        </div>
      </div>
    </div>
  );
}
