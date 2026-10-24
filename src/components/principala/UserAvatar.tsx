// Bulina cu inițiala, mereu aceeași culoare pentru același nume.
const AVATAR_TONES = [
  "bg-rose-500/25 text-rose-200",
  "bg-amber-500/25 text-amber-200",
  "bg-emerald-500/25 text-emerald-200",
  "bg-sky-500/25 text-sky-200",
  "bg-violet-500/25 text-violet-200",
  "bg-fuchsia-500/25 text-fuchsia-200",
  "bg-teal-500/25 text-teal-200",
  "bg-orange-500/25 text-orange-200",
];

export function UserAvatar({ name }: { name: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold uppercase ${
        AVATAR_TONES[h % AVATAR_TONES.length]
      }`}
      aria-hidden
    >
      {name.trim().charAt(0) || "?"}
    </span>
  );
}
