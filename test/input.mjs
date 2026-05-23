// \input re-entrant parse. Run: node test/input.mjs
import { createHTMLWindow } from 'svgdom';
globalThis.window = createHTMLWindow();
globalThis.document = window.document;
const { parse, HtmlGenerator } = await import('../dist/latex.mjs');
const { registerWindow } = await import('@svgdotjs/svg.js');
registerWindow(window, document);
const wrap = (b) => `\\documentclass{article}\n\\begin{document}\n${b}\n\\end{document}`;
let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.log('FAIL ' + m));

// (1) \input splices parsed content; included \section + \label resolve via \ref in the parent
{
  const files = { 'part.tex': '\\section{Included}\\label{sec:inc}Body of include.' };
  const g = new HtmlGenerator({hyphenate:false, tolerant:true, readFile:(n)=>files[n]??null});
  const h = parse(wrap('Before \\input{part} after. Ref \\ref{sec:inc}.'), {generator:g}).htmlDocument().body.innerHTML;
  ok(/Included/.test(h), 'included section heading rendered');
  ok(/Body of include/.test(h), 'included body text rendered');
  ok(/href="#sec-\d+"/.test(h), 'label from the included file resolves via \\ref in the parent');
  ok(/Before/.test(h) && /after/.test(h), 'parent content around \\input is intact');
}
// (2) missing file -> input degradation, no throw
{
  const g = new HtmlGenerator({hyphenate:false, tolerant:true, readFile:()=>null});
  const h = parse(wrap('X \\input{nope} Y'), {generator:g}).htmlDocument().body.innerHTML;
  ok(/X/.test(h) && /Y/.test(h), 'doc renders around a missing \\input');
  ok(g.degradations().some(d=>d.kind==='input'), 'missing input recorded as a degradation');
}
// (3) nested \input
{
  const files = {'a.tex':'A1 \\input{b} A2', 'b.tex':'B-inner'};
  const g = new HtmlGenerator({hyphenate:false, tolerant:true, readFile:(n)=>files[n]??null});
  const h = parse(wrap('\\input{a}'), {generator:g}).htmlDocument().body.innerHTML;
  ok(/A1/.test(h) && /B.inner/.test(h) && /A2/.test(h), 'nested \\input splices correctly');
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
