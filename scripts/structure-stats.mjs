// Regenerează secțiunea „Analiză cantitativă" din STRUCTURE.md.
//
// Rulare: node scripts/structure-stats.mjs        (doar afișează)
//         node scripts/structure-stats.mjs --write (rescrie STRUCTURE.md)
//
// Exista deja un script ad-hoc care a produs tabelul pe 2026-09-18, dar nu era
// păstrat nicăieri — iar un tabel generat pe care nu-l mai poți regenera devine
// exact genul de documentație care rămâne în urmă fără să se vadă. Ăsta e el,
// versionat, cu aceleași coloane: linii, funcții numite, fan-in.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIRS = ["src", "server"];
const SKIP = new Set(["node_modules", ".output", ".git", ".nitro", "dist"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(join(ROOT, d))).map((p) => relative(ROOT, p));

const FN =
  /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+\w+|(?:^|\n)\s*(?:export\s+)?const\s+\w+\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|createServerFn)/g;

const stats = new Map();
const bodies = new Map();
for (const f of files) {
  const src = readFileSync(join(ROOT, f), "utf8");
  bodies.set(f, src);
  stats.set(f, {
    lines: src.split("\n").length,
    fns: (src.match(FN) ?? []).length,
    fanIn: 0,
  });
}

// Fan-in: câte alte fișiere îl importă, prin alias `@/`, cale relativă sau
// `import()` dinamic. Potrivirea se face pe numele fișierului fără extensie,
// ca să prindem și formele fără extensie din importuri.
for (const f of files) {
  const base = f.replace(/\.(ts|tsx)$/, "");
  const short = base.split("/").pop();
  for (const [g, src] of bodies) {
    if (g === f) continue;
    const re = new RegExp(`["'][^"']*\\b${short}["']`);
    if (re.test(src)) stats.get(f).fanIn++;
  }
}

const ZONES = [
  ["`src/routes/` (pagini)", (f) => f.startsWith("src/routes/")],
  ["`src/lib/` (rădăcină, transversale)", (f) => /^src\/lib\/[^/]+$/.test(f)],
  ...[
    "auth",
    "tmdb",
    "media",
    "notifications",
    "errors",
    "system",
    "filelist",
    "services",
    "tvmaze",
  ].map((d) => [`\`src/lib/${d}/\``, (f) => f.startsWith(`src/lib/${d}/`)]),
  ["`src/components/` (toate)", (f) => f.startsWith("src/components/")],
  ["`src/hooks/`", (f) => f.startsWith("src/hooks/")],
  ["`server/plugins/`", (f) => f.startsWith("server/plugins/")],
  ["`server/routes/api/`", (f) => f.startsWith("server/routes/api/")],
];

const nf = (n) => n.toLocaleString("ro-RO").replace(/\./g, " ");
const claimed = new Set();
const zoneRows = ZONES.map(([label, test]) => {
  const fs = files.filter((f) => test(f) && !claimed.has(f));
  fs.forEach((f) => claimed.add(f));
  return `| ${label} | ${fs.length} | ${nf(fs.reduce((a, f) => a + stats.get(f).lines, 0))} |`;
});
const rest = files.filter((f) => !claimed.has(f));
zoneRows.push(
  `| altele | ${rest.length} | ${nf(rest.reduce((a, f) => a + stats.get(f).lines, 0))} |`,
);

const totalLines = files.reduce((a, f) => a + stats.get(f).lines, 0);
const totalFns = files.reduce((a, f) => a + stats.get(f).fns, 0);
const sorted = [...files].sort((a, b) => stats.get(b).lines - stats.get(a).lines);
const hubs = [...files].sort((a, b) => stats.get(b).fanIn - stats.get(a).fanIn).slice(0, 12);

const today = new Date().toISOString().slice(0, 10);
const section = `## Analiză cantitativă

Regenerată cu \`node scripts/structure-stats.mjs --write\` pe ${today} (linii,
funcții numite, fan-in rezolvat prin importurile \`@/\` și relative, inclusiv
\`import()\` dinamic). Tabelul e integral generat — nu are rânduri actualizate
manual, deci nu poate fi parțial vechi.

**Total: ${files.length} fișiere, ~${nf(totalLines)} linii, ~${nf(totalFns)} funcții**

(numărătoare aproximativă — funcții numite, \`const x = (...) =>\` și
\`createServerFn\`, fără metode de clasă sau funcții anonime inline)

### Pe zonă

| Zonă | Fișiere | Linii |
|---|---:|---:|
${zoneRows.join("\n")}

### Fișiere-hub (fan-in mare)

| Fișier | Fan-in | Linii |
|---|---:|---:|
${hubs.map((f) => `| \`${f}\` | ${stats.get(f).fanIn} | ${stats.get(f).lines} |`).join("\n")}

### Tabel complet, toate cele ${files.length} de fișiere

| Fișier | Linii | Funcții | Fan-in |
|---|---:|---:|---:|
${sorted.map((f) => `| \`${f}\` | ${stats.get(f).lines} | ${stats.get(f).fns} | ${stats.get(f).fanIn} |`).join("\n")}
`;

if (process.argv.includes("--write")) {
  const p = join(ROOT, "STRUCTURE.md");
  const doc = readFileSync(p, "utf8");
  const start = doc.indexOf("## Analiză cantitativă");
  const end = doc.indexOf("## Note pentru actualizare");
  if (start === -1 || end === -1) throw new Error("Nu găsesc secțiunile în STRUCTURE.md");
  writeFileSync(p, doc.slice(0, start) + section + "\n---\n\n" + doc.slice(end));
  console.log(`STRUCTURE.md actualizat: ${files.length} fișiere, ${nf(totalLines)} linii.`);
} else {
  console.log(section.slice(0, 1200));
}
