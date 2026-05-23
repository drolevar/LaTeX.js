// Equation references. Run: node test/equation-ref.mjs
import { createHTMLWindow } from 'svgdom';
import { strict as assert } from 'node:assert';
globalThis.window = createHTMLWindow();
globalThis.document = window.document;
const { parse, HtmlGenerator } = await import('../dist/latex.mjs');
const { registerWindow } = await import('@svgdotjs/svg.js');
registerWindow(window, document);
const wrap = (b) => `\\documentclass{article}\n\\begin{document}\n${b}\n\\end{document}`;
let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.log('FAIL ' + m));

// (1) numbered equation: anchor + number; \label stripped; ref + eqref resolve
{
  const gen = new HtmlGenerator({ hyphenate: false, tolerant: true });
  const html = parse(wrap(
    '\\begin{equation}\\label{eq:e}E=mc^2\\end{equation}\n'
    + 'See \\ref{eq:e} and \\eqref{eq:e}.'),
    { generator: gen }).htmlDocument().body.innerHTML;
  ok(/id="eq-\d+"/.test(html), 'equation has an anchor id');
  ok(!/\\label/.test(html), 'no raw \\label text leaked into output');
  ok(!/katex-error/.test(html), 'no katex error from a stray \\label');
  ok(/href="#eq-\d+"/.test(html), 'ref/eqref produce links to the equation anchor');
  ok(/class="eqref"/.test(html), 'eqref emits its wrapper span');
  ok(gen.counter('equation') === 1, 'one numbered equation -> counter == 1');
}
// (2) second equation increments the number
{
  const gen = new HtmlGenerator({ hyphenate: false, tolerant: true });
  parse(wrap('\\begin{equation}a=b\\end{equation}\\begin{equation}c=d\\end{equation}'),
        { generator: gen }).htmlDocument();
  ok(gen.counter('equation') === 2, 'two equations -> counter == 2');
}
// (3) equation* is unnumbered (does not step the counter)
{
  const gen = new HtmlGenerator({ hyphenate: false, tolerant: true });
  parse(wrap('\\begin{equation*}x=y\\end{equation*}'),
        { generator: gen }).htmlDocument();
  ok(gen.counter('equation') === 0, 'equation* does not step the counter');
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
