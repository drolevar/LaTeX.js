// Crash detector for the arXiv bug-hunt loop. Parses one .tex file
// through the forked LaTeX.js in tolerant mode and reports whether it
// renders without a whole-document failure.
//
// Usage:  node latexjs-check.mjs <path-to-main.tex>
//         (the arXiv crawler passes MAIN_TEX as argv[2])
//
// Exit codes:
//   0  rendered (parse + htmlDocument succeeded). Per-formula KaTeX
//      errors are reported on stdout but do NOT fail the file - they
//      are graceful degradations, not whole-doc crashes.
//   1  THREW - a whole-document failure (the crash class we hunt).
//   3  usage / file-read error.
//
// Lives in the fork tree so `import './dist/latex.mjs'` and svgdom
// resolve from the fork's own node_modules; rebuild the fork (npm run
// devbuild) and re-run with no mdview reinstall.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const distUrl = pathToFileURL(resolve(here, 'dist/latex.mjs')).href;

const file = process.argv[2] || process.env.MAIN_TEX;
if (!file) {
    console.error('usage: node latexjs-check.mjs <main.tex>');
    process.exit(3);
}

let src;
try {
    src = readFileSync(file, 'utf8');
} catch (e) {
    console.error('READ_ERROR: ' + e.message);
    process.exit(3);
}

const { createHTMLWindow } = await import('svgdom');
globalThis.window = createHTMLWindow();
globalThis.document = window.document;
const { parse, HtmlGenerator } = await import(distUrl);
const { registerWindow } = await import('@svgdotjs/svg.js');
registerWindow(window, document);

function lineAt(n) {
    const lines = src.split(/\r\n|\n|\r/);
    return (n >= 1 && n <= lines.length) ? lines[n - 1] : '';
}

try {
    const gen = new HtmlGenerator({ hyphenate: false, tolerant: true });
    const doc = parse(src, { generator: gen }).htmlDocument();
    const html = doc.body.innerHTML;
    const katexErrors = (html.match(/katex-error/g) || []).length;
    const degraded = gen.degradations();
    console.log(`RENDER_OK bytes=${html.length} katexErrors=${katexErrors} degraded=${degraded.length}`);
    // Ranked inventory for the bug-hunt aggregation: one line per
    // kind+name. The crawler greps `DEGRADED` lines to build the
    // top-unsupported-constructs backlog.
    const tally = {};
    for (const d of degraded) {
        const key = `${d.kind}\t${d.name ?? ''}`;
        tally[key] = (tally[key] || 0) + 1;
    }
    for (const [key, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
        const [kind, name] = key.split('\t');
        console.log(`  DEGRADED ${kind} ${name} x${n}`);
    }
    if (katexErrors > 0) {
        // Surface a few for triage; not a failure.
        let i = html.indexOf('katex-error'), shown = 0;
        while (i >= 0 && shown < 5) {
            const ctx = html.slice(Math.max(0, i - 80), i)
                .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').slice(-50);
            console.log(`  katex-error near: ...${ctx}`);
            i = html.indexOf('katex-error', i + 1); shown++;
        }
    }
    process.exit(0);
} catch (e) {
    const loc = e.location
        ? ` @${e.location.start.line}:${e.location.start.column}`
        : '';
    console.error(`THREW: ${e.message}${loc}`);
    if (e.location) {
        const n = e.location.start.line;
        console.error(`  line ${n}: ${lineAt(n).trim().slice(0, 160)}`);
    }
    process.exit(1);
}
