/* Assemble the ten mocks: base.css + <style>/<meta> from styles/NN.css + core.js. */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const base = readFileSync(join(here, 'base.css'), 'utf8');
const core = readFileSync(join(here, 'core.js'), 'utf8');
const out = join(here, 'out'); mkdirSync(out, { recursive: true });

const files = readdirSync(join(here, 'styles')).filter((f) => f.endsWith('.css')).sort();
const index = [];
for (const f of files) {
  const css = readFileSync(join(here, 'styles', f), 'utf8');
  const meta = Object.fromEntries([...css.matchAll(/^\/\*\s*@(\w+):\s*(.+?)\s*\*\/$/gm)].map((m) => [m[1], m[2]]));
  const name = f.replace('.css', '');
  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${meta.title}</title>
<style>
${base}
/* ===== ${meta.title} ===== */
${css}
</style>
${meta.darkfirst === 'yes' ? '<script>window.__DARK_FIRST = true;</script>' : ''}
<div class="app" id="app" data-view="markets">
  <header class="nav" id="nav"></header>
  <main class="stage" id="stage"></main>
  <footer class="foot"><span>Mock dashboard · All data is generated locally, deterministic and illustrative — not live market data.</span><span class="clock" id="clock"></span></footer>
</div>
<script>
${core}
</script>
`;
  writeFileSync(join(out, `${name}.html`), html);
  index.push({ name, title: meta.title, blurb: meta.blurb || '', favicon: meta.favicon || '📈' });
  console.log(`  ${name}.html  ${(html.length / 1024).toFixed(0)}KB  ${meta.title}`);
}
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2));
