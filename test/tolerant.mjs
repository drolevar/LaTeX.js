// Regression test for tolerant-mode degradation. Run via:
//   node test/tolerant.mjs
//
// Standalone Node script (no mocha/puppeteer) for the same reason as
// math-env.mjs: the full npm test setup launches Chrome+Firefox for
// screenshot diffs, which isn't available everywhere. Tolerant mode
// is parser/generator behaviour, exercised here via svgdom.
//
// Tolerant mode degrades constructs LaTeX.js does not implement into
// placeholders / no-ops instead of throwing, so a real-world paper
// that mixes supported features with unsupported ones still renders.

import { createHTMLWindow } from 'svgdom';
import { strict as assert } from 'node:assert';

globalThis.window = createHTMLWindow();
globalThis.document = window.document;

const { parse, HtmlGenerator } = await import('../dist/latex.mjs');
const { registerWindow } = await import('@svgdotjs/svg.js');
registerWindow(window, document);

const wrap = (preamble, body) =>
    `\\documentclass{article}\n${preamble}\\begin{document}\n${body}\n\\end{document}`;

// Each case must parse + render without throwing in tolerant mode,
// and (when noted) without leaving a whole-doc failure.
const cases = [
    {
        name: 'unknown macro with braced arg',
        src: wrap('', 'See \\cite{Foo} and \\unknownthing{x} here.'),
    },
    {
        name: 'unknown environment',
        src: wrap('', '\\begin{theorem}A statement.\\end{theorem}'),
    },
    {
        name: 'unknown counter via \\setcounter (amsmath MaxMatrixCols)',
        // The real-paper failure: \setcounter on a counter LaTeX.js
        // does not define used to throw "no such counter".
        src: wrap('\\setcounter{MaxMatrixCols}{10}\n', 'Body text.'),
    },
    {
        name: 'preamble dimension macros',
        src: wrap('\\textheight24cm\n\\textwidth16cm\n', 'Body text.'),
    },
    {
        name: 'unknown documentclass falls back to article',
        // revtex/IEEEtran/llncs/... are not bundled.
        src: '\\documentclass{revtex4-1}\n\\begin{document}\nBody.\n\\end{document}',
    },
    {
        name: 'fnsymbol while counter is 0',
        src: wrap('\\renewcommand{\\thefootnote}{\\fnsymbol{footnote}}\n', 'Body.'),
    },
    {
        name: 'definecolor HTML hex model',
        src: wrap('\\usepackage{xcolor}\n\\definecolor{RuriIro}{HTML}{1E50A2}\n', 'Body.'),
    },
    {
        name: 'underscore in \\label/\\ref key',
        src: wrap('', '\\label{sec:question_B}See \\ref{sec:question_B}.'),
    },
    {
        name: 'optional [short] args on title/author/section + maketitle',
        // Optional-arg support: \author[short]{full} etc. must parse
        // and \maketitle must not crash on any null title/author/date.
        src: '\\documentclass{article}\n\\title[T]{A Long Title}\n'
           + '\\author[A. Auth et al.]{A. Author and B. Author}\n'
           + '\\begin{document}\n\\maketitle\n'
           + '\\section[Sec]{A Section} body.\n\\end{document}',
    },
    {
        name: 'unknown length via \\setlength',
        src: wrap('\\setlength{\\topskip}{12pt}\n', 'Body.'),
    },
    {
        name: 'bare \\setlength macro (no braces)',
        // Valid TeX form \setlength\foo{1pt} (macro arg without braces).
        src: wrap('\\setlength\\abovedisplayskip{14pt}\n', 'Body.'),
    },
    {
        name: 'rgb color spec with spaces',
        src: wrap('\\usepackage{xcolor}\n\\definecolor{db}{rgb}{0, 0, 0.5}\n', 'Body.'),
    },
    {
        name: 'duplicate label',
        src: wrap('', '\\section{A}\\label{x} and \\section{B}\\label{x} again.'),
    },
    {
        name: 'braced key-value (hyperref pdftitle)',
        src: wrap('\\usepackage{hyperref}\n'
                + '\\hypersetup{pdftitle={A Title}, pdfauthor={Auth}}\n', 'Body.'),
    },
    {
        name: 'literal [brackets] in arg AND optional args coexist',
        src: wrap('\\usepackage{xcolor}\n',
            '\\section[Sec]{S} A \\textcolor{red}{[note] text} here.'),
    },
    {
        name: 'graphicspath brace-list',
        src: wrap('\\usepackage{graphicx}\n\\graphicspath{{./fig/}{../img/}}\n', 'Body.'),
    },
    {
        name: 'enumitem star counter \\arabic*',
        src: wrap('', 'Item label uses \\arabic* style.'),
    },
    {
        name: 'non-preamble primitive before documentclass',
        // arXiv papers commonly lead with \pdfoutput=1 etc.
        src: '\\pdfoutput=1\n\\documentclass{article}\n'
           + '\\begin{document}\nBody.\n\\end{document}',
    },
    {
        name: 'lists nested past the depth limit',
        src: wrap('',
            '\\begin{itemize}\\item a\n'
          + '\\begin{itemize}\\item b\n'
          + '\\begin{itemize}\\item c\n'
          + '\\begin{itemize}\\item d\n'
          + '\\begin{itemize}\\item e\n'
          + '\\end{itemize}\\end{itemize}\\end{itemize}\\end{itemize}\\end{itemize}'),
    },
];

let passed = 0;
let failed = 0;

for (const { name, src } of cases) {
    try {
        const gen = new HtmlGenerator({ hyphenate: false, tolerant: true });
        const doc = parse(src, { generator: gen }).htmlDocument();
        assert.ok(doc.body.innerHTML.length > 0, `${name}: empty body`);
        console.log(`ok   ${name}`);
        passed++;
    } catch (e) {
        console.log(`FAIL ${name}: ${e.message}`);
        failed++;
    }
}

// Strict mode (tolerant:false) must STILL throw on an unknown
// counter - the tolerance is opt-in, not a silent behaviour change.
try {
    const gen = new HtmlGenerator({ hyphenate: false });
    parse(wrap('\\setcounter{Nope}{1}\n', 'x'), { generator: gen }).htmlDocument();
    console.log('FAIL strict mode should still throw on unknown counter');
    failed++;
} catch {
    console.log('ok   strict mode still throws on unknown counter');
    passed++;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
