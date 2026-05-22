// Seam A + degradation reporting. Run: node test/degradation.mjs
// Asserts unknown macros and throwing handlers are contained as a
// visible placeholder AND recorded in gen.degradations().
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
const ok = (cond, msg) => cond ? passed++ : (failed++, console.log(`FAIL ${msg}`));

// (1) unknown macro -> visible placeholder + recorded degradation
{
    const gen = new HtmlGenerator({ hyphenate: false, tolerant: true });
    const doc = parse(wrap('See \\nopackagedef{x} here.'), { generator: gen }).htmlDocument();
    const html = doc.body.innerHTML;
    ok(html.includes('latex-unsupported'), 'unknown macro emits .latex-unsupported span');
    const d = gen.degradations();
    ok(Array.isArray(d), 'degradations() returns an array');
    ok(d.some(x => x.kind === 'unknown-macro' && x.name === 'nopackagedef'),
        'unknown macro recorded as kind=unknown-macro');
}

// (2) a handler that throws at runtime is contained (Seam A)
{
    const gen = new HtmlGenerator({ hyphenate: false, tolerant: true });
    gen._macros['textbf'] = () => { throw new Error('boom'); };
    const doc = parse(wrap('A \\textbf{x} B'), { generator: gen }).htmlDocument();
    const html = doc.body.innerHTML;
    ok(html.length > 0, 'throwing handler still renders body');
    ok(html.includes('latex-unsupported'), 'throwing handler emits placeholder');
    ok(gen.degradations().some(x => x.kind === 'macro-threw' && x.name === 'textbf'),
        'throwing handler recorded as kind=macro-threw');
}

// (3) strict mode still throws on a throwing handler (tolerance is opt-in)
{
    let threw = false;
    try {
        const gen = new HtmlGenerator({ hyphenate: false });
        gen._macros['textbf'] = () => { throw new Error('boom'); };
        parse(wrap('A \\textbf{x} B'), { generator: gen }).htmlDocument();
    } catch { threw = true; }
    ok(threw, 'strict mode still propagates a handler throw');
}

// (4) a stray & in an unknown env nested inside another env must not
//     leak group state and mangle the outer environment (the 22821
//     abstract-with-tblr case).
{
    const gen = new HtmlGenerator({ hyphenate: false, tolerant: true });
    const src = wrap('\\begin{abstract}\nBefore. \\begin{tblr}{colspec={c|c}}a & b\\end{tblr} After.\n\\end{abstract}');
    const html = parse(src, { generator: gen }).htmlDocument().body.innerHTML;
    ok(!/beginabstract/.test(html), 'stray & in nested unknown env does not mangle the outer env');
    ok(JSON.stringify(gen._groups) === '[0]', 'group stack stays balanced (no leak)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
