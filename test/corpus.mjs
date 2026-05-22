// Fork-local no-crash gate: every .tex under test/corpus/ must render
// to the end in tolerant mode (no whole-document throw). 100% - any
// throw fails the gate. Reduced repros of real-world failure classes
// plus a few reduced real papers live here; each containment hole the
// live arXiv probe finds is added as a fixture.
//   node test/corpus.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHTMLWindow } from 'svgdom';

globalThis.window = createHTMLWindow();
globalThis.document = window.document;
const { parse, HtmlGenerator } = await import('../dist/latex.mjs');
const { registerWindow } = await import('@svgdotjs/svg.js');
registerWindow(window, document);

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'corpus');
const files = readdirSync(dir).filter(f => f.endsWith('.tex')).sort();

let passed = 0, failed = 0;
for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8');
    try {
        const gen = new HtmlGenerator({ hyphenate: false, tolerant: true });
        const doc = parse(src, { generator: gen }).htmlDocument();
        if (doc.body.innerHTML.length === 0) throw new Error('empty body');
        console.log(`ok   ${f} (degraded=${gen.degradations().length})`);
        passed++;
    } catch (e) {
        const loc = e.location
            ? ` @${e.location.start.line}:${e.location.start.column}` : '';
        console.log(`FAIL ${f}: ${e.message}${loc}`);
        failed++;
    }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
