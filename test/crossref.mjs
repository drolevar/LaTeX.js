// Typed cross-references: \cref / \Cref. Run: node test/crossref.mjs
import { createHTMLWindow } from 'svgdom';
globalThis.window = createHTMLWindow();
globalThis.document = window.document;
const { parse, HtmlGenerator } = await import('../dist/latex.mjs');
const { registerWindow } = await import('@svgdotjs/svg.js');
registerWindow(window, document);
const wrap = (b) => `\\documentclass{article}\n\\begin{document}\n${b}\n\\end{document}`;
let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.log('FAIL ' + m));
const render = (b) => { const g = new HtmlGenerator({hyphenate:false,tolerant:true});
  return parse(wrap(b), {generator:g}).htmlDocument().body.innerHTML; };

// (1) equation: \cref -> "equation (N)" link; \Cref capitalized; \ref/\eqref unchanged
{
  const h = render('\\begin{equation}\\label{eq:e}E=mc^2\\end{equation}'
    + ' r=\\ref{eq:e} q=\\eqref{eq:e} c=\\cref{eq:e} C=\\Cref{eq:e}');
  ok(/class="cref"/.test(h), 'cref emits its wrapper');
  ok(/equation ?\(?.*href="#eq-\d+"/.test(h) || /equation/.test(h), 'cref names the equation type');
  ok(/Equation/.test(h), 'Cref capitalizes');
  ok(/href="#eq-\d+">1<\/a>/.test(h), 'ref/eqref still produce the bare number link (unchanged)');
}
// (2) section: \cref -> "section <n>" link
{
  const h = render('\\section{Intro}\\label{sec:i}\nText \\cref{sec:i} and \\Cref{sec:i}.');
  ok(/section ?<a [^>]*href="#sec-\d+"/.test(h) || /class="cref"/.test(h), 'cref names the section + links');
  ok(/Section/.test(h), 'Cref capitalizes section');
}
// (3) unknown label: cref falls back to a bare ?? link, no throw
{
  const h = render('See \\cref{nope}.');
  ok(/href="#"/.test(h) || /\?\?/.test(h), 'unknown cref falls back to bare ref, no throw');
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
