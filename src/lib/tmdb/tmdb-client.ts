const TMDB_BASE = "https://api.themoviedb.org/3";

function tmdbHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.TMDB_API_KEY ?? ""}`,
    Accept: "application/json",
  };
}

export async function tmdbFetch<T>(path: string, timeoutMs = 8000): Promise<T> {
  const res = await fetch(`${TMDB_BASE}${path}`, {
    headers: tmdbHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`TMDB a răspuns ${res.status}`);
  return res.json() as Promise<T>;
}
