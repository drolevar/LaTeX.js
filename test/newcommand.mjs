// \newcommand. Run: node test/newcommand.mjs
import { createHTMLWindow } from 'svgdom';
globalThis.window = createHTMLWindow();
globalThis.document = window.document;
const { parse, HtmlGenerator } = await import('../dist/latex.mjs');
const { registerWindow } = await import('@svgdotjs/svg.js');
registerWindow(window, document);
let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.log('FAIL ' + m));
const render = (pre, body) => { const g = new HtmlGenerator({hyphenate:false,tolerant:true});
  return parse(`\\documentclass{article}\n${pre}\\begin{document}\n${body}\n\\end{document}`, {generator:g}).htmlDocument().body.innerHTML; };

// (1) math shorthand expands via KaTeX (no error), no-arg
{
  const h = render('\\newcommand{\\R}{\\mathbb{R}}\n', 'Let $x \\in \\R$ hold.');
  ok(!/katex-error/.test(h), 'math shorthand: no katex error');
  ok(/class="katex/.test(h), 'math rendered');
}
// (2) math macro with an arg expands via KaTeX
{
  const h = render('\\newcommand{\\norm}[1]{\\left\\|#1\\right\\|}\n', 'Value $\\norm{x}$.');
  ok(!/katex-error/.test(h), 'math macro with arg: no katex error');
}
// (3) text macro, no args -> reparsed body
{
  const h = render('\\newcommand{\\dataset}{ImageNet}\n', 'We use \\dataset for training.');
  ok(/ImageNet/.test(h), 'text macro expands to its body');
}
// (4) text macro with an arg -> #1 substituted + reparsed
{
  const h = render('\\newcommand{\\strong}[1]{\\textbf{#1}}\n', 'This is \\strong{bold} text.');
  ok(/<b[> ]|<strong|class="bf"/.test(h) && /bold/.test(h), 'text macro with arg substitutes #1 and renders markup');
}
// (5) \renewcommand overrides
{
  const h = render('\\newcommand{\\foo}{first}\\renewcommand{\\foo}{second}\n', 'Got \\foo.');
  ok(/second/.test(h) && !/first/.test(h), 'renewcommand overrides');
}
// (6) recursion guard: self-reference does not hang
{
  const h = render('\\newcommand{\\loop}{\\loop}\n', 'X \\loop Y');
  ok(/X/.test(h) && /Y/.test(h), 'self-referential macro is contained, doc still renders');
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
