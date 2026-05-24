// Figure/table captions + \ref/\cref. Run: node test/float-caption.mjs
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

// (1) figure caption numbered + anchored; \ref + \cref resolve
{
  const h = render(
    '\\begin{figure}\\caption{First fig}\\label{fig:a}\\end{figure}\n'
    + 'see \\ref{fig:a} / \\cref{fig:a}');
  ok(/Figure 1:/.test(h), 'caption renders "Figure 1:"');
  ok(/id="figure-\d+"/.test(h), 'caption block is anchored');
  ok(/href="#figure-\d+">1<\/a>/.test(h), 'ref resolves to the figure number link');
  ok(/figure[\s ]<a [^>]*href="#figure-\d+"/.test(h), 'cref says "figure <link>"');
}
// (2) table caption numbered independently; second figure increments
{
  const h = render(
    '\\begin{figure}\\caption{F1}\\end{figure}'
    + '\\begin{figure}\\caption{F2}\\label{fig:2}\\end{figure}'
    + '\\begin{table}\\caption{T1}\\label{tab:1}\\end{table}'
    + ' \\ref{fig:2} \\ref{tab:1}');
  ok(/Figure 2:/.test(h), 'second figure is Figure 2');
  ok(/Table 1:/.test(h), 'table counter is independent (Table 1)');
}
// (3) \caption outside a float: renders text, no number, no throw
{
  const h = render('\\caption{orphan}');
  ok(/orphan/.test(h) && !/Figure/.test(h), 'orphan caption renders text without a number');
}
// (4) bracket math in a caption argument must not leak a group. A bare ]
// in math used to fail to parse in a balanced (argument) context, backtrack,
// and strand the float's group, leaking its alignment onto the body.
{
  const g = new HtmlGenerator({ hyphenate: false, tolerant: true });
  const h = parse(wrap(
    '\\begin{figure}\\centering\\caption{$f(x)=[a,b]$, \\(y=[c]^2\\)}\\label{fig:m}\\end{figure}'),
    { generator: g }).htmlDocument().body.innerHTML;
  ok(g._stack.length === 1, 'bracket-math caption leaves no leaked group');
  ok(!/<div class="body[^"]*(centering|raggedright)/.test(h),
     'body container not polluted by a leaked alignment');
}
// (5) \includegraphics width is converted to a valid CSS dimension
// (\textwidth-relative -> percent) so the image scales to the column; the
// raw "width: 0.48\textwidth" was invalid CSS, dropped by the browser ->
// the image rendered at full natural size and overflowed.
{
  const g = new HtmlGenerator({ hyphenate: false, tolerant: true });
  const html = parse(
    '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n'
    + '\\includegraphics[width=0.48\\textwidth]{x.png}\n\\end{document}',
    { generator: g }).htmlDocument().body.innerHTML;
  ok(/<img[^>]*width:\s*48%/.test(html), 'includegraphics width=0.48\\textwidth -> 48%');
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
