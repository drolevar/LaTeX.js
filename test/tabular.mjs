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

// (h) booktabs: \toprule/\midrule/\bottomrule -> per-row classes.
{
  const { body } = render(doc('\\begin{tabular}{ll}\\toprule a & b \\\\ \\midrule c & d \\\\ \\bottomrule\\end{tabular}'));
  const rows = body.querySelectorAll('table.latex-tabular tr');
  ok(rows.length === 2, 'h: two data rows survive three booktabs rules');
  ok(rows.length === 2 && /latex-toprule/.test(rows[0].getAttribute('class') || ''),
     'h: first row has latex-toprule');
  ok(rows.length === 2 && /latex-midrule/.test(rows[1].getAttribute('class') || ''),
     'h: second row has latex-midrule');
  ok(rows.length === 2 && /latex-bottomrule/.test(rows[1].getAttribute('class') || ''),
     'h: second row has latex-bottomrule (trailing rule -> previous row)');
}

// (i) \cmidrule(lr){2-3} marks exactly cells 2 and 3 of the FOLLOWING row.
{
  const { body } = render(doc('\\begin{tabular}{lll}a & b & c \\\\ \\cmidrule(lr){2-3} d & e & f\\end{tabular}'));
  const rows = body.querySelectorAll('table.latex-tabular tr');
  ok(rows.length === 2, 'i: two data rows');
  const cells = rows.length === 2 ? rows[1].querySelectorAll('td') : [];
  ok(cells.length === 3, 'i: second row has three cells');
  ok(cells.length === 3 && !/latex-cmidrule/.test(cells[0].getAttribute('class') || ''),
     'i: cell 1 of next row has no cmidrule class');
  ok(cells.length === 3 && /latex-cmidrule/.test(cells[1].getAttribute('class') || ''),
     'i: cell 2 of next row has cmidrule class');
  ok(cells.length === 3 && /latex-cmidrule/.test(cells[2].getAttribute('class') || ''),
     'i: cell 3 of next row has cmidrule class');
}

// (i2) \cline{a-b} behaves the same as \cmidrule without a trim spec.
{
  const { body } = render(doc('\\begin{tabular}{ll}a & b \\\\ \\cline{1-1} c & d\\end{tabular}'));
  const rows = body.querySelectorAll('table.latex-tabular tr');
  const cells = rows.length === 2 ? rows[1].querySelectorAll('td') : [];
  ok(cells.length === 2 && /latex-cmidrule/.test(cells[0].getAttribute('class') || ''),
     'i2: \\cline marks cell 1 of the next row');
  ok(cells.length === 2 && !/latex-cmidrule/.test(cells[1].getAttribute('class') || ''),
     'i2: \\cline does not mark cell 2');
}

// (j) \multicolumn{2}{c}{X}: colspan=2, centered, row cell count reflects the span.
{
  const { body } = render(doc('\\begin{tabular}{lll}\\multicolumn{2}{c}{X} & y \\\\ a & b & c\\end{tabular}'));
  const rows = body.querySelectorAll('table.latex-tabular tr');
  ok(rows.length === 2, 'j: two rows');
  const firstRowCells = rows.length === 2 ? rows[0].querySelectorAll('td') : [];
  ok(firstRowCells.length === 2, 'j: first row has two <td> (spanned + plain)');
  ok(firstRowCells.length === 2 && firstRowCells[0].getAttribute('colspan') === '2',
     'j: spanned cell has colspan=2');
  ok(firstRowCells.length === 2 && /latex-col-c/.test(firstRowCells[0].getAttribute('class') || ''),
     'j: spanned cell is centered per its own spec');
}

// (k) {|l|r|} vline classes on the outer edges (left of col1, right of col2).
{
  const { body } = render(doc('\\begin{tabular}{|l|r|}a & b\\end{tabular}'));
  const cells = body.querySelectorAll('table.latex-tabular td');
  ok(cells.length === 2, 'k: two cells');
  ok(cells.length === 2 && /latex-vline-left/.test(cells[0].getAttribute('class') || ''),
     'k: cell 1 has a left vline');
  ok(cells.length === 2 && /latex-vline-right/.test(cells[0].getAttribute('class') || ''),
     'k: cell 1 has a right vline (inner |)');
  ok(cells.length === 2 && /latex-vline-right/.test(cells[1].getAttribute('class') || ''),
     'k: cell 2 has a right vline (trailing |)');
}

// (l) |*{2}{c}: the vline belongs only to the first column, not each repetition.
{
  const { body } = render(doc('\\begin{tabular}{|*{2}{c}}a & b\\end{tabular}'));
  const cells = body.querySelectorAll('table.latex-tabular td');
  ok(cells.length === 2, 'l: two cells');
  ok(cells.length === 2 && /latex-vline-left/.test(cells[0].getAttribute('class') || ''),
     'l: cell 1 has the left vline');
  ok(cells.length === 2 && !/latex-vline-left/.test(cells[1].getAttribute('class') || ''),
     'l: cell 2 does NOT have a left vline (regression for the *{n}{sub} clone bug)');
}

// (m) plain-text cell content has no nested <p> (no injected block margins).
{
  const { body } = render(doc('\\begin{tabular}{l}a\\end{tabular}'));
  const td = body.querySelector('table.latex-tabular td');
  ok(td !== null && td.querySelector('p') === null,
     'm: a plain-text cell has no nested <p>');
}

// (n) mismatched \begin{tabular}...\end{tabular*} does not produce a table.
{
  const { body } = render(doc('\\begin{tabular}{l} a \\end{tabular*}'));
  ok(body.querySelector('table.latex-tabular') === null,
     'n: mismatched begin/end names does not render a table');
}

// (o) an isolated \midrule (bounded by \\ on both sides) must not vanish:
// it attaches as a bottom border on the row before it.
{
  const { body } = render(doc('\\begin{tabular}{ll}a & b \\\\ \\midrule \\\\ c & d\\end{tabular}'));
  const rows = body.querySelectorAll('table.latex-tabular tr');
  ok(rows.length === 2, 'o: two data rows survive the isolated midrule');
  const anyMidruleClass = Array.from(rows).some((r) => /midrule/.test(r.getAttribute('class') || ''));
  ok(anyMidruleClass, 'o: the isolated midrule leaves a class on SOME row (regression: it used to vanish)');
  ok(rows.length === 2 && /latex-midrule-bottom/.test(rows[0].getAttribute('class') || ''),
     'o: this fix attaches it as latex-midrule-bottom on the row before it');
}

// (p) an isolated \cmidrule(lr){2-2} row between two data rows marks cell 2
// of the FOLLOWING data row (not the row before it).
{
  const { body } = render(doc('\\begin{tabular}{ll}a & b \\\\ \\cmidrule(lr){2-2} \\\\ c & d\\end{tabular}'));
  const rows = body.querySelectorAll('table.latex-tabular tr');
  ok(rows.length === 2, 'p: two data rows survive the isolated cmidrule');
  const firstCells = rows.length === 2 ? rows[0].querySelectorAll('td') : [];
  const nextCells = rows.length === 2 ? rows[1].querySelectorAll('td') : [];
  ok(firstCells.length === 2 && !/latex-cmidrule/.test(firstCells[0].getAttribute('class') || '') &&
     !/latex-cmidrule/.test(firstCells[1].getAttribute('class') || ''),
     'p: the row before the isolated cmidrule is untouched');
  ok(nextCells.length === 2 && !/latex-cmidrule/.test(nextCells[0].getAttribute('class') || ''),
     'p: cell 1 of the following row has no cmidrule class');
  ok(nextCells.length === 2 && /latex-cmidrule/.test(nextCells[1].getAttribute('class') || ''),
     'p: cell 2 of the following row has the cmidrule class');
}

// (q) an unbalanced { in a cell (its } lost to cell splitting) must not
// leak group/font state past the table - and must be reported exactly
// once via degradations(), not silently.
{
  const { body, g } = render(doc('\\begin{tabular}{ll}{\\bf a & b\\end{tabular}\nafter'));
  const table = body.querySelector('table.latex-tabular');
  ok(table !== null, 'q: table still renders despite the unbalanced cell');
  ok(!/after/.test(
       Array.from(body.querySelectorAll('.bf')).map((n) => n.textContent).join(' ')
     ),
     'q: "after" is not inside a .bf-classed element');
  const unbalanced = g.degradations().filter((d) => d.kind === 'unbalanced-fragment');
  ok(unbalanced.length === 1, 'q: exactly one unbalanced-fragment degradation entry');
}

// (r) a cell containing an unclosed \begin{itemize} that ALSO has its own
// unclosed { inside (\item {\bf x, both closers lost to cell splitting)
// leaks two extra frames onto ONE leaked level. A recovery that unwinds
// in the wrong order (endBalanced before the level's own frames are
// drained) pops the level while a stale frame is still on the stack -
// this must not happen: following text must not leak the .bf attribute,
// and exactly one unbalanced-fragment entry is reported.
{
  const { body, g } = render(
    doc('\\begin{tabular}{l}\\begin{itemize} \\item {\\bf x\\end{tabular}\nafter {\\bf y} z'));
  const table = body.querySelector('table.latex-tabular');
  ok(table !== null, 'r: table still renders despite the unclosed cell env+brace');
  const bfTexts = Array.from(body.querySelectorAll('.bf')).map((n) => n.textContent).join(' ');
  ok(!/after/.test(bfTexts) && !/\bz\b/.test(bfTexts),
     'r: "after"/"z" do not leak into a .bf-classed element');
  ok(/\by\b/.test(bfTexts),
     'r: a later {\\bf y} still bolds y (stack sanity after recovery)');
  const unbalanced = g.degradations().filter((d) => d.kind === 'unbalanced-fragment');
  ok(unbalanced.length === 1, 'r: exactly one unbalanced-fragment degradation entry');
}

// (s) a cell containing a stray, unmatched } (no matching { in the cell)
// NOTE: a stray \end{...} cannot reproduce over-closing here - without
// a matching begin it never reaches g.end() (the tolerant fallback
// consumes it char-by-char with zero group side effects); the bare }
// is the real reproducer. Do not "restore" an \end-based fixture.
// hits the tolerant grammar's "close an ambient open group" fallback,
// which operates on whatever level is CURRENTLY current - i.e. the
// ENCLOSING tabular environment's own level, not anything scoped to
// this cell. Left unrepaired this pops a frame/level that belongs to
// the table itself. Content around the stray } must survive, exactly
// one unbalanced-fragment entry is reported, and the enclosing table's
// own accounting must stay intact enough that a later {\bf y} still
// bolds only y (proof the outer frame wasn't corrupted).
{
  const { body, g } = render(
    doc('\\begin{tabular}{l}a } b\\end{tabular}\nafter {\\bf y} z'));
  const table = body.querySelector('table.latex-tabular');
  ok(table !== null, 's: table still renders despite the stray } in the cell');
  const text = body.textContent || '';
  ok(/a/.test(text) && /b/.test(text), 's: cell text around the stray } survives');
  const unbalanced = g.degradations().filter((d) => d.kind === 'unbalanced-fragment');
  ok(unbalanced.length === 1, 's: exactly one unbalanced-fragment degradation entry');
  const bfTexts = Array.from(body.querySelectorAll('.bf')).map((n) => n.textContent).join(' ');
  ok(/\by\b/.test(bfTexts) && !/\bz\b/.test(bfTexts) && !/after/.test(bfTexts),
     's: a later {\\bf y} bolds only y - the enclosing table context was repaired, not left corrupt');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
