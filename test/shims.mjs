// Preamble user-macro expansion + common-package shims + subfigure box.
// Run: node test/shims.mjs
import { createHTMLWindow } from 'svgdom';
globalThis.window = createHTMLWindow();
globalThis.document = window.document;
const { parse, HtmlGenerator } = await import('../dist/latex.mjs');
const { registerWindow } = await import('@svgdotjs/svg.js');
registerWindow(window, document);
let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.log('FAIL ' + m));
const render = (tex) => {
  const g = new HtmlGenerator({ hyphenate: false, tolerant: true });
  const body = parse(tex, { generator: g }).htmlDocument().body;
  return { html: body.innerHTML, body, g };
};

// (1) a meta-macro (a \newcommand whose body is itself a \newcommand) invoked
// in the PREAMBLE must define its target, which then expands in the body.
{
  const { html, g } = render(
    '\\documentclass{article}\n'
    + '\\newcommand{\\mk}[2]{\\newcommand{#1}{[#2]}}\n'
    + '\\mk{\\foo}{X}\n'
    + '\\begin{document}\\foo\\end{document}');
  ok(g.hasMacro('foo'), 'preamble meta-macro defines its target');
  ok(/\[X\]/.test(html), 'preamble-defined target expands in the body');
}
// (2) \xspace renders a space, not a red placeholder
{
  const { html } = render('\\documentclass{article}\\begin{document}A\\xspace B\\end{document}');
  ok(!/latex-unsupported/.test(html), 'xspace is not an unsupported placeholder');
}
// (3) subfigure is a width-box and the image lands inside it; includegraphics
// works because subcaption maps onto graphicx.
{
  const { body } = render(
    '\\documentclass{article}\\usepackage{subcaption}\\begin{document}\n'
    + '\\begin{figure}\\begin{subfigure}{0.4\\textwidth}'
    + '\\includegraphics[width=\\linewidth]{a.png}\\end{subfigure}\\end{figure}\\end{document}');
  const box = body.querySelector('.subfigure');
  ok(box !== null, 'subfigure renders a box');
  ok(box !== null && /width:\s*40%/.test(box.getAttribute('style') || ''), 'subfigure width is 40% (0.4\\textwidth)');
  ok(body.querySelector('.subfigure img') !== null, 'includegraphics lands inside the subfigure box (graphicx via subcaption)');
}
// (4) booktabs rules + \num + \makecell degrade cleanly (no red), content kept
{
  const { html } = render('\\documentclass{article}\\begin{document}\\num{1234} \\makecell{cell} \\toprule\\end{document}');
  ok(!/latex-unsupported/.test(html), 'num/makecell/booktabs are not unsupported');
  ok(/1234/.test(html) && /cell/.test(html), 'num + makecell keep their content');
}
// (5) \DeclareRobustCommand defines a command via the \newcommand machinery
// (here in the preamble, with the star form, like a paper's \escapeus).
{
  const { html, g } = render(
    '\\documentclass{article}\\DeclareRobustCommand*{\\foo}[1]{[#1]}\n'
    + '\\begin{document}\\foo{x}\\end{document}');
  ok(g.hasMacro('foo'), 'DeclareRobustCommand defines the command');
  ok(/\[x\]/.test(html), 'DeclareRobustCommand command expands with its arg');
}
// (6) \newcommand{\nc}{\newcommand} aliases a definer; \nc{..}{..} must behave
// like \newcommand (the body alone can't grab the trailing args, so \nc is
// aliased straight to the definer).
{
  const { html, g } = render(
    '\\documentclass{article}\\newcommand{\\nc}{\\newcommand}\\nc{\\foo}{ZZ}\n'
    + '\\begin{document}\\foo\\end{document}');
  ok(g.hasMacro('foo'), 'nc (alias of newcommand) defines its target');
  ok(/ZZ/.test(html), 'nc-defined macro expands in the body');
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
