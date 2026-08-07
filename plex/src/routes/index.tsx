import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-3xl font-bold">FaikkitBox Plex</h1>
      <p className="max-w-md text-neutral-400">
        Caută, descarcă și gestionează propriul conținut pe Plex — self-service, fără să mă
        deranjezi de fiecare dată.
      </p>
      <div className="flex gap-4">
        <Link
          to="/register"
          className="rounded-md bg-sky-600 px-5 py-2 font-medium hover:bg-sky-500"
        >
          Client Nou
        </Link>
        <Link
          to="/login"
          className="rounded-md border border-neutral-700 px-5 py-2 font-medium hover:bg-neutral-900"
        >
          Client Existent
        </Link>
      </div>
    </div>
  );
}
