// \cite numbering/links + \bibliography reference list. Run:
//   node test/bibliography.mjs
import { createHTMLWindow } from 'svgdom';
import { strict as assert } from 'node:assert';
globalThis.window = createHTMLWindow();
globalThis.document = window.document;
const { parse, HtmlGenerator } = await import('../dist/latex.mjs');
const { registerWindow } = await import('@svgdotjs/svg.js');
registerWindow(window, document);

const wrap = (body) =>
  `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}`;
let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.log('FAIL ' + m));

// (1) appearance-order numbering + links, repeats reuse the number
{
  const gen = new HtmlGenerator({ hyphenate: false, tolerant: true });
  const html = parse(wrap('A \\cite{alpha} B \\cite{beta} C \\cite{alpha}.'),
                     { generator: gen }).htmlDocument().body.innerHTML;
  ok(/href="#cite-alpha"/.test(html), 'alpha link present');
  ok(/href="#cite-beta"/.test(html),  'beta link present');
  // alpha -> 1 (twice), beta -> 2
  ok((html.match(/href="#cite-alpha"[^>]*>1</g) || []).length === 2,
     'alpha is [1] both times');
  ok(/href="#cite-beta"[^>]*>2</.test(html), 'beta is [2]');
}
// (2) \bibliography renders cited entries with anchors; readFile feeds
//     the .bib; an uncited entry is omitted; a cited-but-missing key is
//     anchored + degraded.
{
  const bib = `@article{alpha, author={A. One}, title={First}, year={2020}}
@book{gamma, author={G. Three}, title={Unused}, year={2019}}`;
  const gen = new HtmlGenerator({
    hyphenate: false, tolerant: true,
    readFile: (n) => n === 'refs.bib' ? bib : null,
  });
  const src = wrap('See \\cite{alpha} and \\cite{missing}.\n\\bibliography{refs}');
  const html = parse(src, { generator: gen }).htmlDocument().body.innerHTML;
  ok(/<ol[^>]*class="[^"]*latex-bibliography/.test(html), 'reference list rendered');
  ok(/id="cite-alpha"/.test(html), 'alpha entry anchored');
  ok(/First/.test(html), 'alpha entry text from .bib');
  ok(!/Unused/.test(html), 'uncited entry omitted');
  ok(!/\[object|undefined/.test(html), 'no junk for missing fields');
  ok(/id="cite-missing"[^>]*data-unresolved/.test(html), 'missing key anchored + flagged');
  ok(gen.degradations().some(d => d.kind === 'cite' && d.name === 'missing'),
     'missing key recorded as degradation');
}
// (3) no readFile -> a bibliography degradation, no list, no throw
{
  const gen = new HtmlGenerator({ hyphenate: false, tolerant: true });
  const html = parse(wrap('\\cite{x}\n\\bibliography{refs}'),
                     { generator: gen }).htmlDocument().body.innerHTML;
  ok(/href="#cite-x"/.test(html), 'cite link still emitted without a .bib');
  ok(gen.degradations().some(d => d.kind === 'bibliography'),
     'absent .bib recorded as bibliography degradation');
}
// (4) a bare unquoted numeric value (year = 2023) before a newline-} must
// parse - key() keeps the trailing \n since it is not a stop char, so trim
// before the ^[0-9]+$ test. And one malformed entry must not lose the rest
// of the file (per-entry resync to the next @).
{
  const bib = `@misc{good1, title={Alpha}, year = 2023
}
@article{broken, title = }
@article{good2, author={B}, title={Beta}, year={2021}}`;
  const gen = new HtmlGenerator({
    hyphenate: false, tolerant: true,
    readFile: (n) => n === 'refs.bib' ? bib : null,
  });
  const html = parse(wrap('See \\cite{good1} and \\cite{good2}.\n\\bibliography{refs}'),
                     { generator: gen }).htmlDocument().body.innerHTML;
  ok(/Alpha/.test(html), 'bare-number (year=2023) entry parsed: title shown');
  ok(/Beta/.test(html), 'entry after a malformed one still parsed (resync)');
  ok(!/id="cite-good1"[^>]*data-unresolved/.test(html), 'good1 resolved');
  ok(!/id="cite-good2"[^>]*data-unresolved/.test(html), 'good2 resolved');
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
