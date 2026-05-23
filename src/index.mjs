import he from 'he'
import { parse, SyntaxError } from './latex-parser'
import { Generator } from './generator'
import { HtmlGenerator } from './html-generator'
import { LaTeXJSComponent } from './latex.component'

// Re-entrant fragment parse for \input / \newcommand bodies. The
// generator can't import the parser (circular), so the composition root
// wires it onto the prototype; `this` is the generator at call time.
Generator.prototype._reparse = function (text) {
    return parse(text, { startRule: 'fragment', generator: this });
};

export {
    he,
    parse,
    SyntaxError,
    Generator,
    HtmlGenerator,
    LaTeXJSComponent
}
