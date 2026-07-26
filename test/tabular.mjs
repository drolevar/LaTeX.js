// Tabular core: raw-capture rule -> colspec -> row/cell split -> per-cell
// reparse -> aligned HTML table. Run: node test/tabular.mjs
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
const doc = (inner) =>
  '\\documentclass{article}\\begin{document}\n' + inner + '\n\\end{document}';

// (a) 2x2 {lr}: one table, 2 rows, 4 cells, first col left, last col right.
{
  const { body } = render(doc('\\begin{tabular}{lr}a & b \\\\ c & d\\end{tabular}'));
  const table = body.querySelector('table.latex-tabular');
  ok(table !== null, 'a: renders one table.latex-tabular');
  ok(table !== null && table.querySelectorAll('tr').length === 2, 'a: two rows');
  const cells = table ? table.querySelectorAll('td') : [];
  ok(cells.length === 4, 'a: four cells');
  ok(cells.length === 4 && /latex-col-l/.test(cells[0].getAttribute('class') || ''),
     'a: first cell is left-aligned');
  ok(cells.length === 4 && /latex-col-r/.test(cells[cells.length - 1].getAttribute('class') || ''),
     'a: last cell is right-aligned');
}

// (b) \hline after row 1 -> the second row carries latex-hline (border-top).
{
  const { body } = render(doc('\\begin{tabular}{ll}a & b \\\\ \\hline c & d\\end{tabular}'));
  const rows = body.querySelectorAll('table.latex-tabular tr');
  ok(rows.length === 2, 'b: two rows survive an inter-row \\hline');
  ok(rows.length === 2 && /latex-hline/.test(rows[1].getAttribute('class') || ''),
     'b: second row has latex-hline');
  ok(rows.length === 2 && !/latex-hline/.test(rows[0].getAttribute('class') || ''),
     'b: first row has no hline');
}

// (c) cell content reparses: \textbf and inline math render inside cells.
{
  const { body } = render(doc('\\begin{tabular}{ll}\\textbf{x} & $x^2$\\end{tabular}'));
  const table = body.querySelector('table.latex-tabular');
  ok(table !== null && table.querySelector('td .bf') !== null,
     'c: \\textbf renders a bold (.bf) element inside a cell');
  ok(table !== null && table.querySelector('td .katex') !== null,
     'c: inline math renders a katex element inside a cell');
}

// (d) no raw ampersand leaks into the rendered text (the amp-soup symptom).
{
  const { body } = render(doc('\\begin{tabular}{ll}a & b \\\\ c & d\\end{tabular}'));
  ok(!/&/.test(body.textContent || ''), 'd: no ampersand in rendered text');
}

// (e) a brace-nested & does not split the cell.
{
  const { body } = render(doc('\\begin{tabular}{l}{a & b}\\end{tabular}'));
  const cells = body.querySelectorAll('table.latex-tabular td');
  ok(cells.length === 1, 'e: brace-nested ampersand does not split into two cells');
}

// (f) tabularx: a leading {width} is discarded, X columns still render.
{
  const { body } = render(doc('\\begin{tabularx}{\\textwidth}{lX} a & b \\\\ \\end{tabularx}'));
  ok(body.querySelector('table.latex-tabular') !== null, 'f: tabularx renders a table');
  ok(!/&/.test(body.textContent || ''), 'f: no ampersand in tabularx text');
}

// (g) tabular*: same, with an explicit width group.
{
  const { body } = render(doc('\\begin{tabular*}{5cm}{ll} a & b \\\\ \\end{tabular*}'));
  ok(body.querySelector('table.latex-tabular') !== null, 'g: tabular* renders a table');
  ok(!/&/.test(body.textContent || ''), 'g: no ampersand in tabular* text');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
