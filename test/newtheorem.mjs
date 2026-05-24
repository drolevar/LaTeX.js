// \newtheorem. Run: node test/newtheorem.mjs
import { createHTMLWindow } from 'svgdom';
globalThis.window = createHTMLWindow();
globalThis.document = window.document;
const { parse, HtmlGenerator } = await import('../dist/latex.mjs');
const { registerWindow } = await import('@svgdotjs/svg.js');
registerWindow(window, document);
const wrap = (b) => `\\documentclass{article}\n${b.preamble||''}\\begin{document}\n${b.body}\n\\end{document}`;
let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.log('FAIL ' + m));
const render = (preamble, body) => { const g = new HtmlGenerator({hyphenate:false,tolerant:true});
  return parse(`\\documentclass{article}\n${preamble}\\begin{document}\n${body}\n\\end{document}`, {generator:g}).htmlDocument().body.innerHTML; };

// (1) numbered theorem: head "Lemma 1." + \ref/\cref resolve
{
  const h = render('\\newtheorem{lemma}{Lemma}\n',
    '\\begin{lemma}\\label{l:a}All x.\\end{lemma}\nSee \\ref{l:a} / \\cref{l:a}.');
  ok(/Lemma 1\./.test(h), 'theorem head "Lemma 1."');
  ok(/All x\./.test(h), 'theorem body rendered');
  ok(/href="#thm-\d+">1</.test(h), 'ref resolves to the theorem number');
  ok(/lemma <a [^>]*href="#thm-\d+"|class="cref"/.test(h), 'cref names + links the theorem');
}
// (2) second theorem increments
{
  const h = render('\\newtheorem{thm}{Theorem}\n',
    '\\begin{thm}A\\end{thm}\\begin{thm}\\label{t2}B\\end{thm} \\ref{t2}');
  ok(/Theorem 2\./.test(h), 'second theorem is Theorem 2');
}
// (3) starred = unnumbered; \theoremstyle ignored, no throw
{
  const h = render('\\theoremstyle{remark}\\newtheorem*{rem}{Remark}\n',
    '\\begin{rem}Note.\\end{rem}');
  ok(/Remark\./.test(h) && !/Remark 1/.test(h), 'starred theorem is unnumbered');
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
