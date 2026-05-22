// Regression test for tolerant-mode degradation. Run via:
//   node test/tolerant.mjs
//
// Standalone Node script (no mocha/puppeteer) for the same reason as
// math-env.mjs: the full npm test setup launches Chrome+Firefox for
// screenshot diffs, which isn't available everywhere. Tolerant mode
// is parser/generator behaviour, exercised here via svgdom.
//
// Tolerant mode degrades constructs LaTeX.js does not implement into
// placeholders / no-ops instead of throwing, so a real-world paper
// that mixes supported features with unsupported ones still renders.

import { createHTMLWindow } from 'svgdom';
import { strict as assert } from 'node:assert';

globalThis.window = createHTMLWindow();
globalThis.document = window.document;

const { parse, HtmlGenerator } = await import('../dist/latex.mjs');
const { registerWindow } = await import('@svgdotjs/svg.js');
registerWindow(window, document);

const wrap = (preamble, body) =>
    `\\documentclass{article}\n${preamble}\\begin{document}\n${body}\n\\end{document}`;

// Each case must parse + render without throwing in tolerant mode,
// and (when noted) without leaving a whole-doc failure.
const cases = [
    {
        name: 'unknown macro with braced arg',
        src: wrap('', 'See \\cite{Foo} and \\unknownthing{x} here.'),
    },
    {
        name: 'unknown environment',
        src: wrap('', '\\begin{theorem}A statement.\\end{theorem}'),
    },
    {
        name: 'unknown counter via \\setcounter (amsmath MaxMatrixCols)',
        // The real-paper failure: \setcounter on a counter LaTeX.js
        // does not define used to throw "no such counter".
        src: wrap('\\setcounter{MaxMatrixCols}{10}\n', 'Body text.'),
    },
    {
        name: 'preamble dimension macros',
        src: wrap('\\textheight24cm\n\\textwidth16cm\n', 'Body text.'),
    },
    {
        name: 'unknown documentclass falls back to article',
        // revtex/IEEEtran/llncs/... are not bundled.
        src: '\\documentclass{revtex4-1}\n\\begin{document}\nBody.\n\\end{document}',
    },
    {
        name: 'fnsymbol while counter is 0',
        src: wrap('\\renewcommand{\\thefootnote}{\\fnsymbol{footnote}}\n', 'Body.'),
    },
    {
        name: 'definecolor HTML hex model',
        src: wrap('\\usepackage{xcolor}\n\\definecolor{RuriIro}{HTML}{1E50A2}\n', 'Body.'),
    },
    {
        name: 'underscore in \\label/\\ref key',
        src: wrap('', '\\label{sec:question_B}See \\ref{sec:question_B}.'),
    },
    {
        name: 'literal [brackets] inside an argument',
        src: wrap('\\usepackage{xcolor}\n', 'A \\textcolor{red}{[note] text} here.'),
    },
    {
        name: 'unknown length via \\setlength',
        src: wrap('\\setlength{\\topskip}{12pt}\n', 'Body.'),
    },
    {
        name: 'rgb color spec with spaces',
        src: wrap('\\usepackage{xcolor}\n\\definecolor{db}{rgb}{0, 0, 0.5}\n', 'Body.'),
    },
];

let passed = 0;
let failed = 0;

for (const { name, src } of cases) {
    try {
        const gen = new HtmlGenerator({ hyphenate: false, tolerant: true });
        const doc = parse(src, { generator: gen }).htmlDocument();
        assert.ok(doc.body.innerHTML.length > 0, `${name}: empty body`);
        console.log(`ok   ${name}`);
        passed++;
    } catch (e) {
        console.log(`FAIL ${name}: ${e.message}`);
        failed++;
    }
}

// Strict mode (tolerant:false) must STILL throw on an unknown
// counter - the tolerance is opt-in, not a silent behaviour change.
try {
    const gen = new HtmlGenerator({ hyphenate: false });
    parse(wrap('\\setcounter{Nope}{1}\n', 'x'), { generator: gen }).htmlDocument();
    console.log('FAIL strict mode should still throw on unknown counter');
    failed++;
} catch {
    console.log('ok   strict mode still throws on unknown counter');
    passed++;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
