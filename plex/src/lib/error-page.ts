export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="ro"><head><meta charset="utf-8" /><title>Eroare</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0b0f;color:#eee;display:flex;
align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{text-align:center;max-width:28rem;padding:2rem}
h1{font-size:1.25rem}p{color:#aaa}
a{color:#7dd3fc}</style></head>
<body><div class="box"><h1>A apărut o eroare</h1>
<p>Încearcă să reîncarci pagina.</p>
<a href="/">Înapoi acasă</a></div></body></html>`;
}
