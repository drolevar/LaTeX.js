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
// (7) a macro colouring math with a custom \definecolor name (KaTeX rejects
// e.g. blind_magenta) must still render: the \color switch is stripped from
// the KaTeX expansion, so the math renders uncoloured, not as a red error.
{
  const { html } = render(
    '\\documentclass{article}\\usepackage{xcolor}\\definecolor{blind_magenta}{HTML}{DC267F}\n'
    + '\\newcommand{\\vv}{{\\color{blind_magenta}\\mathcal{T}}}\n'
    + '\\begin{document}$\\vv = \\vv$\\end{document}');
  ok(!/katex-error/.test(html), 'custom-colour math macro renders without a KaTeX error');
  ok(/class="katex"/.test(html), 'the math actually rendered');
}
// (8) adjustbox + wrapfigure render their content / box, not red
{
  const { html } = render(
    '\\documentclass{article}\\usepackage{wrapfig}\\begin{document}\n'
    + '\\adjustbox{trim=0 0 0 1cm,clip}{ABC}\n'
    + '\\begin{wrapfigure}{r}{0.3\\textwidth}XYZ\\end{wrapfigure}\\end{document}');
  ok(!/latex-unsupported/.test(html), 'adjustbox/wrapfigure are not unsupported');
  ok(/ABC/.test(html) && /XYZ/.test(html), 'adjustbox/wrapfigure content renders');
}
// (9) \hypersetup is a silent core no-op: no text leak, no degradation entry
{
  const { html, g } = render(
    '\\documentclass{article}\\begin{document}'
    + '\\hypersetup{colorlinks=true,pdftitle={My Doc}}A\\end{document}');
  ok(!/latex-unsupported/.test(html), 'hypersetup does not render as unsupported');
  ok(!/colorlinks|pdftitle/.test(html), 'hypersetup options do not leak as body text');
  ok(g.degradations().every((d) => d.name !== 'hypersetup'), 'hypersetup logs no degradation');
  ok(/A/.test(html), 'text following hypersetup still renders');
}
// (10) \bf / \it / \rm are declaration-style font switches whose scope ends
// at the enclosing group's closing brace (like \bfseries etc.)
{
  const { html } = render(
    '\\documentclass{article}\\begin{document}{\\bf bold}after\\end{document}');
  ok(/class="bf">bold<\/span>/.test(html), '\\bf bolds the group content');
  ok(!/class="[^"]*\bbf\b[^"]*">after/.test(html), '\\bf scope ends at the group close');
}
{
  const { html } = render(
    '\\documentclass{article}\\begin{document}{\\it italic}after\\end{document}');
  ok(/class="it">italic<\/span>/.test(html), '\\it italicizes the group content');
  ok(!/class="[^"]*\bit\b[^"]*">after/.test(html), '\\it scope ends at the group close');
}
{
  const { html } = render(
    '\\documentclass{article}\\begin{document}{\\rm text}after\\end{document}');
  ok(/class="rm">text<\/span>/.test(html), '\\rm switches the family for the group content');
  ok(!/class="[^"]*\brm\b[^"]*">after/.test(html), '\\rm scope ends at the group close');
}
// \sc, \tt, \sl grouped together: same shape, one example each is enough
{
  const { html } = render(
    '\\documentclass{article}\\begin{document}{\\sc a}{\\tt b}{\\sl c}\\end{document}');
  ok(/class="sc">a<\/span>/.test(html), '\\sc sets small-caps shape');
  ok(/class="tt">b<\/span>/.test(html), '\\tt sets the typewriter family');
  ok(/class="sl">c<\/span>/.test(html), '\\sl sets the slanted shape');
}
// (11) \DeclareMathOperator(*) registers a KaTeX operator; the body (with TeX
// spacing like \,) must reach KaTeX untouched and render without an error
{
  const { html } = render(
    '\\documentclass{article}\\DeclareMathOperator*{\\argmax}{arg\\,max}\n'
    + '\\begin{document}$\\argmax_x f(x)$\\end{document}');
  ok(!/katex-error/.test(html), 'DeclareMathOperator operator renders without a KaTeX error');
  ok(/class="mop"/.test(html), 'the operator name renders via KaTeX\'s upright operator class (\\operatorname)');
  ok(!/documentclassarticle/.test(html), 'the preamble around the definition parses cleanly, no char-fallback leak');
}
// (12) \textcolor: named color gets a latex-color-<name> span; gray!NN mixes
// degrade to the base name; unknown colors render uncolored, not red
{
  const { html } = render(
    '\\documentclass{article}\\usepackage{xcolor}\\begin{document}'
    + '\\textcolor{red}{RED}\\end{document}');
  ok(/latex-color-red/.test(html), 'textcolor red gets class latex-color-red');
  ok(/RED/.test(html), 'textcolor content is kept');
}
{
  const { html } = render(
    '\\documentclass{article}\\usepackage{xcolor}\\begin{document}'
    + '\\textcolor{gray!30}{G}\\end{document}');
  ok(/latex-color-gray/.test(html), 'gray!30 degrades to the base latex-color-gray class');
}
{
  const { html } = render(
    '\\documentclass{article}\\usepackage{xcolor}\\begin{document}'
    + '\\textcolor{blindmagenta}{U}\\end{document}');
  ok(!/latex-unsupported/.test(html), 'an unknown color name is not flagged unsupported');
  ok(!/latex-color-/.test(html), 'an unknown color name gets no color class');
  ok(/U/.test(html), 'unknown-color content still renders');
}
// \textcolor must also work with no \usepackage{xcolor} at all (core fallback)
{
  const { html } = render(
    '\\documentclass{article}\\begin{document}\\textcolor{blue}{B}\\end{document}');
  ok(/latex-color-blue/.test(html), 'textcolor works without \\usepackage{xcolor}');
}
// (13) itemize/enumerate/description accept + discard an enumitem-style
// optional arg: the list still renders and the arg text never leaks
{
  const { body, html } = render(
    '\\documentclass{article}\\begin{document}'
    + '\\begin{itemize}[leftmargin=*]\\item A\\end{itemize}\\end{document}');
  ok(body.querySelector('ul') !== null, 'itemize[leftmargin=*] still renders a list');
  ok(!/leftmargin/.test(html), 'the itemize optional arg is consumed, not leaked as text');
}
{
  const { body, html } = render(
    '\\documentclass{article}\\begin{document}'
    + '\\begin{enumerate}[leftmargin=*]\\item A\\end{enumerate}\\end{document}');
  ok(body.querySelector('ol') !== null, 'enumerate[leftmargin=*] still renders a list');
  ok(!/leftmargin/.test(html), 'the enumerate optional arg is consumed, not leaked as text');
}
{
  const { body, html } = render(
    '\\documentclass{article}\\begin{document}'
    + '\\begin{description}[leftmargin=*]\\item[A] B\\end{description}\\end{document}');
  ok(body.querySelector('dl') !== null, 'description[leftmargin=*] still renders a list');
  ok(!/leftmargin/.test(html), 'the description optional arg is consumed, not leaked as text');
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
