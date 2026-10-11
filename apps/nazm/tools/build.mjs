/* Bundle the app into one self-contained HTML file (no module fetches, works from file:// and in sandboxed hosts).
   Usage: node apps/nazm/tools/build.mjs [--check]  →  apps/nazm/dist/nazm.html
   --check writes nothing and exits 1 when the committed dist is out of date with src/. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const mods = new Map(); // path → transformed body
const order = [];       // dependency order (dependencies first)

function transform(path, src) {
  const dir = posix.dirname(path);
  const resolve = (spec) => posix.normalize(posix.join(dir, spec));
  const names = [];
  const deps = [];

  let out = src.replace(/^import\s+([\s\S]*?)\s+from\s+['"](\.[^'"]+)['"];?[ \t]*$/gm, (_, clause, spec) => {
    const target = resolve(spec);
    deps.push(target);
    clause = clause.trim();
    const req = `__r(${JSON.stringify(target)})`;
    const parts = [];
    const ns = clause.match(/\*\s+as\s+(\w+)/);
    if (ns) return `const ${ns[1]} = ${req};`;
    const def = clause.match(/^(\w+)\s*(,|$)/);
    if (def) parts.push(`const ${def[1]} = ${req}.default;`);
    const named = clause.match(/\{([\s\S]*)\}/);
    if (named) {
      const list = named[1].split(',').map((x) => x.trim()).filter(Boolean)
        .map((x) => { const [a, b] = x.split(/\s+as\s+/); return b ? `${a}: ${b}` : a; });
      parts.push(`const { ${list.join(', ')} } = ${req};`);
    }
    return parts.join(' ');
  });

  out = out.replace(/^export\s+default\s+/gm, () => { names.push(['default', null]); return '__default = '; });
  out = out.replace(/^export\s+(async\s+)?(function\*?|const|let|class)\s+([\w$]+)/gm, (_, a, kind, name) => { names.push([name, name]); return `${a || ''}${kind} ${name}`; });
  out = out.replace(/^export\s+\{([^}]*)\};?[ \t]*$/gm, (_, list) => {
    list.split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => { const [a, b] = x.split(/\s+as\s+/); names.push([b || a, a]); });
    return '';
  });

  const hasDefault = names.some(([n]) => n === 'default');
  const tail = names.map(([n, local]) => (n === 'default' ? '' : `__exports.${n} = ${local};`)).join('\n');
  const body = `${hasDefault ? 'let __default;\n' : ''}${out}\n${tail}${hasDefault ? '\n__exports.default = __default;' : ''}`;
  return { body, deps };
}

const visiting = new Set();
function load(path) {
  if (mods.has(path)) return;
  if (visiting.has(path)) throw new Error(`circular import involving ${path}`);
  visiting.add(path);
  const { body, deps } = transform(path, read(path));
  deps.forEach(load);
  visiting.delete(path);
  mods.set(path, body);
  order.push(path);
}

load('src/main.js');

const script = `(function () {
'use strict';
const __defs = {};
const __cache = {};
function __r(p) {
  if (__cache[p]) return __cache[p];
  const __exports = (__cache[p] = {});
  __defs[p](__exports);
  return __exports;
}
${order.map((p) => `__defs[${JSON.stringify(p)}] = function (__exports) {\n${mods.get(p)}\n};`).join('\n')}
__r('src/main.js');
})();`;

const css = ['tokens', 'base', 'components', 'pages'].map((n) => read(`css/${n}.css`)).join('\n');
const html = read('index.html')
  .replace(/\s*<link rel="stylesheet" href="css\/[^"]+">/g, '')
  .replace('</head>', () => `  <style>\n${css}\n  </style>\n</head>`)
  .replace('<script type="module" src="src/main.js"></script>', () => `<script>\n${script.replace(/<\/script/gi, '<\\/script')}\n</script>`);

if (process.argv.includes('--check')) {
  const file = join(root, 'dist/nazm.html');
  if (!existsSync(file) || readFileSync(file, 'utf8') !== html) { console.error('dist/nazm.html is out of date — run: node apps/nazm/tools/build.mjs'); process.exit(1); }
  console.log('dist/nazm.html is up to date');
  process.exit(0);
}
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/nazm.html'), html);
console.log(`dist/nazm.html  ${(html.length / 1024).toFixed(0)} KB, ${order.length} modules`);
