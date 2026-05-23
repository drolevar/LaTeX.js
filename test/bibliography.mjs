// \cite numbering/links + \bibliography reference list. Run:
//   node test/bibliography.mjs
import { createHTMLWindow } from 'svgdom';
import { strict as assert } from 'node:assert';
globalThis.window = createHTMLWindow();
globalThis.document = window.document;
const { parse, HtmlGenerator } = await import('../dist/latex.mjs');
const { registerWindow } = await import('@svgdotjs/svg.js');
registerWindow(window, document);

const wrap = (body) =>
  `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}`;
let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.log('FAIL ' + m));

// (1) appearance-order numbering + links, repeats reuse the number
{
  const gen = new HtmlGenerator({ hyphenate: false, tolerant: true });
  const html = parse(wrap('A \\cite{alpha} B \\cite{beta} C \\cite{alpha}.'),
                     { generator: gen }).htmlDocument().body.innerHTML;
  ok(/href="#cite-alpha"/.test(html), 'alpha link present');
  ok(/href="#cite-beta"/.test(html),  'beta link present');
  // alpha -> 1 (twice), beta -> 2
  ok((html.match(/href="#cite-alpha"[^>]*>1</g) || []).length === 2,
     'alpha is [1] both times');
  ok(/href="#cite-beta"[^>]*>2</.test(html), 'beta is [2]');
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
