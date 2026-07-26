// Float variants (table*/figure*/wraptable/wrapfigure) + the
// unknown-environment marker chip. Run: node test/env-degrade.mjs
import { createHTMLWindow } from 'svgdom';
globalThis.window = createHTMLWindow();
globalThis.document = window.document;
const { parse, HtmlGenerator } = await import('../dist/latex.mjs');
const { registerWindow } = await import('@svgdotjs/svg.js');
registerWindow(window, document);
let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.log('FAIL ' + m));
const doc = (inner) =>
  '\\documentclass{article}\\begin{document}\n' + inner + '\n\\end{document}';
const render = (tex) => {
  const g = new HtmlGenerator({ hyphenate: false, tolerant: true });
  const body = parse(tex, { generator: g }).htmlDocument().body;
  return { html: body.innerHTML, body, g };
};

// (1) table*: renders like a plain table, numbers "Table 1:", no fused
// "begintable*" text and no leaked "[!t]" optional-placement arg.
{
  const { html } = render(doc('\\begin{table*}[!t]\\caption{X}\\end{table*}'));
  ok(!/begintable/.test(html), 'table*: no fused "begintable" text');
  ok(!/\[!t\]/.test(html), 'table*: no leaked [!t] placement arg');
  ok(/Table 1:/.test(html), 'table*: caption numbers as Table 1');
  ok(/X/.test(html), 'table*: caption text present');
}

// (2) wraptable: [lines]{placement}{width} consumed, numbers under the
// table counter.
{
  const { html, body } = render(doc(
    '\\begin{wraptable}{r}{5cm}\\caption{Y}\\end{wraptable}'));
  ok(!/beginwraptable/.test(html), 'wraptable: no fused "beginwraptable" text');
  ok(body.querySelector('.wraptable') !== null, 'wraptable: renders a box');
  ok(/Table 1:/.test(html), 'wraptable: caption numbers as Table 1 (table counter)');
  ok(/Y/.test(html), 'wraptable: caption text present');
}

// (3) wrapfigure numbers under the figure counter (caption says Figure).
{
  const { html, body } = render(doc(
    '\\begin{wrapfigure}{r}{5cm}\\caption{Z}\\end{wrapfigure}'));
  ok(!/beginwrapfigure/.test(html), 'wrapfigure: no fused "beginwrapfigure" text');
  ok(body.querySelector('.wrapfigure') !== null, 'wrapfigure: renders a box');
  ok(/Figure 1:/.test(html), 'wrapfigure: caption numbers as Figure 1 (figure counter)');
}

// (4) an unknown env renders exactly one chip, keeps its body, and
// records exactly one degradation entry.
{
  const { html, body, g } = render(doc('\\begin{promptbox}Body\\end{promptbox}'));
  const chips = body.querySelectorAll('.latex-env-chip');
  ok(chips.length === 1, 'promptbox: exactly one .latex-env-chip');
  ok(chips.length === 1 && chips[0].textContent === '[promptbox]',
     'promptbox: chip text is exactly "[promptbox]"');
  ok(/Body/.test(html), 'promptbox: body text still present');
  const hits = g.degradations().filter(
    (d) => d.kind === 'unknown-env' && d.name === 'promptbox');
  ok(hits.length === 1, 'promptbox: exactly one unknown-env degradation recorded');
}

// (5) two different unknown envs -> two chips, two entries.
{
  const { body, g } = render(doc(
    '\\begin{promptbox}A\\end{promptbox}\\begin{tcolorbox}B\\end{tcolorbox}'));
  const chips = body.querySelectorAll('.latex-env-chip');
  ok(chips.length === 2, 'two unknown envs: two chips');
  const hits = g.degradations().filter((d) => d.kind === 'unknown-env');
  ok(hits.length === 2, 'two unknown envs: two degradation entries');
  ok(hits.some((d) => d.name === 'promptbox') && hits.some((d) => d.name === 'tcolorbox'),
     'two unknown envs: both names recorded');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
