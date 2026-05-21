// Regression test for the math-environment grammar rule. Run via:
//   node test/math-env.mjs
//
// Standalone Node script (no mocha/puppeteer): LaTeX.js's full
// `npm test` setup boots a Chrome+Firefox stack for screenshot
// diffs, which fails to launch on environments without those
// browsers. The math-env feature is parser-level, so we just
// exercise it via svgdom + plain assertions.

import { createHTMLWindow } from 'svgdom';
import { strict as assert } from 'node:assert';

globalThis.window = createHTMLWindow();
globalThis.document = window.document;

const { parse, HtmlGenerator } =
    await import('../dist/latex.mjs');
const { registerWindow } = await import('@svgdotjs/svg.js');
registerWindow(window, document);

function render(src, opts = {}) {
    const gen = new HtmlGenerator({ hyphenate: false, ...opts });
    return parse(src, { generator: gen }).htmlDocument();
}

const wrap = (body) =>
    `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}`;

const cases = [
    { name: 'equation env',  src: wrap('\\begin{equation}E = mc^2\\end{equation}') },
    { name: 'equation*',     src: wrap('\\begin{equation*}E = mc^2\\end{equation*}') },
    { name: 'eqnarray',      src: wrap('\\begin{eqnarray}a &=& b + c\\\\d &=& e\\end{eqnarray}') },
    { name: 'eqnarray*',     src: wrap('\\begin{eqnarray*}a &=& b\\end{eqnarray*}') },
    { name: 'align',         src: wrap('\\begin{align}x &= 1\\\\ y &= 2\\end{align}') },
    { name: 'align*',        src: wrap('\\begin{align*}x &= 1\\\\ y &= 2\\end{align*}') },
    { name: 'gather',        src: wrap('\\begin{gather}a = 1\\\\ b = 2\\end{gather}') },
    { name: 'multline',      src: wrap('\\begin{multline}a + b\\\\ + c + d\\end{multline}') },
    { name: 'displaymath',   src: wrap('\\begin{displaymath}E = mc^2\\end{displaymath}') },
];

let passed = 0;
let failed = 0;

for (const { name, src } of cases) {
    try {
        const doc = render(src);
        assert.ok(doc.body.innerHTML.length > 0,
                  `body innerHTML empty for ${name}`);
        const html = doc.body.innerHTML;
        assert.ok(html.includes('katex') || html.includes('mord'),
                  `${name}: missing KaTeX output in HTML (got first 200 chars: ${html.slice(0, 200)})`);
        console.log(`ok   ${name}`);
        passed++;
    } catch (e) {
        console.log(`FAIL ${name}: ${e.message}`);
        failed++;
    }
}

// Negative test: malformed env still errors out clearly (NOT thrown
// as a DOM appendChild error in the embedding browser).
try {
    render(wrap('\\begin{equation}\\end{eqnarray}'));
    console.log('FAIL mismatched-end should have thrown');
    failed++;
} catch (e) {
    // The grammar's name === end_name guard rejects this; a
    // sibling rule (h_environment) then also rejects -> overall
    // parse error. Either way it MUST be a SyntaxError, not a
    // DOM TypeError.
    if (e.name === 'SyntaxError') {
        console.log('ok   mismatched-end env produces SyntaxError');
        passed++;
    } else {
        console.log(`FAIL mismatched-end: wrong error type ${e.name}: ${e.message}`);
        failed++;
    }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
