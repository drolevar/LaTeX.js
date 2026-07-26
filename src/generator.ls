import
    './latex.ltx': { LaTeX }
    './symbols': { diacritics, symbols }
    './types': { makeLengthClass }
    './bibtex-parse': bibtexParse

Macros = LaTeX

Object.defineProperty Array.prototype, 'top',
    enumerable: false
    configurable: true
    get: -> @[* - 1]
    set: (v) !-> @[* - 1] = v


export class Generator

    ### public instance vars (vars beginning with "_" are meant to be private!)

    documentClass: null     # name of the default document class until \documentclass{}, then the actual class instance
    documentTitle: null

    # initialize only in CTOR, otherwise the objects end up in the prototype
    _options: null
    _macros: null

    _stack: null
    _groups: null

    _continue: false

    _labels: null
    _refs: null
    _degradations: null
    _citations: null

    _counters: null
    _resets: null

    _marginpars: null

    Length: null

    reset: !->
        @Length = makeLengthClass @

        @documentClass = @_options.documentClass
        @documentTitle = "untitled"

        @_uid = 1

        @_macros = {}
        @_curArgs = []  # stack of argument declarations

        # stack for local variables and attributes - entering a group adds another entry,
        # leaving a group removes the top entry
        @_stack = [
            attrs: {}
            align: null
            currentlabel:
                id: ""
                type: ""
                label: document.createTextNode ""
            lengths: new Map()
        ]

        # grouping stack, keeps track of difference between opening and closing brackets
        @_groups = [ 0 ]

        @_labels = new Map()
        @_refs = new Map()
        @_citations = new Map()
        @_degradations = []
        @_crefNames = {}
        @_userArgs = {}
        @_katexMacros = {}
        @_captionType = null

        @_marginpars = []

        @_counters = new Map()
        @_resets = new Map()

        @_continue = false

        @newCounter \enumi
        @newCounter \enumii
        @newCounter \enumiii
        @newCounter \enumiv

        # do this after creating the sectioning counters because \thepart etc. are already predefined
        @_macros = new Macros @, @_options.CustomMacros

        # equation counter: created after Macros so \theequation is set on the live instance
        @newCounter \equation


    # helpers

    nextId: ->
        @_uid++

    round: (num) ->
        const factor = Math.pow 10, @_options.precision
        Math.round(num * factor) / factor



    # private static for easy access - but it means no parallel generator usage!
    error = (e) !->
        console.error e
        throw new Error e

    error: (e) !-> error e

    setErrorFn: (e) !->
        error := e
        @_errorFn = e

    # parse a body-level fragment into THIS generator (re-entrant). Saves
    # and restores the parser-bound location/error fn the nested parse
    # clobbers. Tolerant: a failed fragment parse degrades, never throws.
    reparse: (content) ->
        return @createFragment! if not content
        savedLoc = @location
        savedErr = @_errorFn
        savedStackLen = @_stack.length
        savedGroupsLen = @_groups.length
        try
            nodes = @_reparse content
        catch e
            nodes = @unsupportedNode \input, "input", "input parse failed: #{e.message}"
        finally
            @location = savedLoc if savedLoc
            @setErrorFn savedErr if savedErr
            leaked = false

            # Under-closing: an unclosed { or \begin left in the fragment
            # (its closer lost to cell splitting) leaves enterGroup/
            # startBalanced un-exited. Unwind exactly like end() does -
            # exitGroup (drain the innermost level's own opens) THEN
            # endBalanced (pop that now-balanced level) - but loop per
            # level instead of assuming one exitGroup suffices, since a
            # leaked env can itself contain a further unclosed { that
            # pushed extra frames onto the same level.
            while @_groups.length > savedGroupsLen or @_stack.length > savedStackLen
                if @_groups.length > savedGroupsLen
                    if @isBalanced!
                        @endBalanced!
                    else
                        @exitGroup!
                else
                    # no leaked level left, but a plain { opened directly
                    # at the snapshot's own level is still unclosed
                    @exitGroup!
                leaked = true

            # Over-closing: a stray \end in the fragment (no matching
            # \begin in this fragment) runs end()'s unconditional
            # endBalanced even when exitGroup underflowed - popping a
            # level/frame that belongs to the ENCLOSING context. Repair
            # by padding back to the snapshot shape with the generator's
            # own start/enter calls; the popped frame's content is gone,
            # but the structural invariant the rest of the document
            # depends on is restored.
            while @_groups.length < savedGroupsLen
                @startBalanced!
                leaked = true
            while @_stack.length < savedStackLen
                @enterGroup!
                leaked = true

            @reportDegradation \unbalanced-fragment, null, "unbalanced group in reparsed fragment" if leaked
        nodes

    # Tolerant-mode fallback for the PEG grammar's unknown_macro
    # rule. Strict mode keeps the original throwing behaviour;
    # tolerant mode emits a visible placeholder so the rest of the
    # document still parses + renders, and records the degradation.
    unknownMacro: (name) ->
        if not @_options?.tolerant
            error "unknown macro: \\#{name}"
            return []
        [ @unsupportedNode \unknown-macro, name, "unsupported macro \\#{name}" ]

    # Tolerant-mode degradation log. Every place that skips or
    # downgrades an unsupported construct records one entry, so the
    # host + the bug-hunt detector can report what was dropped - the
    # signal that replaces "did it crash?".
    reportDegradation: (kind, name, reason) !->
        @_degradations.push { kind, name, reason }

    degradations: -> @_degradations

    # Visible placeholder for a dropped construct, plus its record:
    # <span class="latex-unsupported" data-kind=".." title="reason">\name</span>.
    # Shared by unknownMacro, the macro() runtime-throw catch, and the
    # Seam B argError bail-out. @create / @inline / @createText are
    # HtmlGenerator methods; `this` is always an HtmlGenerator.
    unsupportedNode: (kind, name, reason) ->
        @reportDegradation kind, name, reason
        el = @create @inline, (@createText "\\" + name), "latex-unsupported"
        el.setAttribute "title", reason
        el.setAttribute "data-kind", kind
        el

    # Marker for an unknown environment's \begin:
    # <span class="latex-unsupported latex-env-chip" data-kind="unknown-env"
    # title="unknown environment">[name]</span>. Parallels unsupportedNode
    # (own reportDegradation call), but bracketed rather than backslashed
    # since an environment name, unlike a macro, isn't itself an escape.
    envChipNode: (name) ->
        @reportDegradation \unknown-env, name, "unknown environment"
        el = @create @inline, (@createText "[" + name + "]"), "latex-unsupported latex-env-chip"
        el.setAttribute "title", "unknown environment"
        el.setAttribute "data-kind", "unknown-env"
        el


    ### tabular

    # read a balanced {..} at s[j] (j on '{'); returns [content, next].
    readBalancedGroup: (s, j) ->
        depth = 0
        start = j
        while j < s.length
            ch = s[j]
            if ch == '{'
                depth = depth + 1
            else if ch == '}'
                depth = depth - 1
                return [ s.substring(start + 1, j), j + 1 ] if depth == 0
            j = j + 1
        [ s.substring(start + 1), s.length ]

    # Column spec text (e.g. "|l|c|p{3cm}|") -> array of
    # { align, borderLeft, borderRight }. Widths and @/!/>/< content are
    # consumed; *{n}{sub} is pre-expanded. F2 extends the column types.
    parseColspec: (spec) ->
        cols = []
        return cols if not spec
        border = 0
        i = 0
        n = spec.length
        while i < n
            c = spec[i]
            if c == ' ' or c == '\t' or c == '\n' or c == '\r'
                i = i + 1
            else if c == '|'
                # a | borders both the column before it and the one after
                border = border + 1
                cols[cols.length - 1].borderRight = true if cols.length > 0
                i = i + 1
            else if c == 'l' or c == 'c' or c == 'r'
                cols.push { align: c, borderLeft: border > 0, borderRight: false }
                border = 0
                i = i + 1
            else if c == 'p' or c == 'm' or c == 'b' or c == 'X'
                # p/m/b take a {width}; X (tabularx) stretches. All left-align.
                i = i + 1
                if spec[i] == '{'
                    r = @readBalancedGroup spec, i
                    i = r[1]
                cols.push { align: 'l', borderLeft: border > 0, borderRight: false }
                border = 0
            else if c == '@' or c == '!'
                # inter-column material / rule; consume its {..}. ! draws a line.
                rule = c == '!'
                i = i + 1
                if spec[i] == '{'
                    r = @readBalancedGroup spec, i
                    i = r[1]
                border = border + 1 if rule
            else if c == '>' or c == '<'
                # array-package per-cell decl; consume {..}, ignored in F1.
                i = i + 1
                if spec[i] == '{'
                    r = @readBalancedGroup spec, i
                    i = r[1]
            else if c == '*'
                # *{n}{sub}: repeat sub n times, pre-expanded. A pending
                # leading border applies once, to the far-left column only -
                # not to the shared sub-spec template (which would leak it
                # into every repetition).
                i = i + 1
                reps = 0
                if spec[i] == '{'
                    r = @readBalancedGroup spec, i
                    reps = (parseInt r[0].trim!, 10) or 0
                    i = r[1]
                sub = ''
                if spec[i] == '{'
                    r = @readBalancedGroup spec, i
                    sub = r[0]
                    i = r[1]
                if reps > 0 and sub
                    expanded = @parseColspec sub
                    pendingBorder = border > 0
                    border = 0
                    for _r from 1 to reps
                        for col, ci in expanded
                            bl = col.borderLeft
                            bl = true if pendingBorder and _r == 1 and ci == 0
                            cols.push { align: col.align, borderLeft: bl, borderRight: col.borderRight }
            else
                i = i + 1
        cols

    # \multicolumn{n}{spec}{content} recognized at a cell's start -> a
    # spanning td whose own alignment/borders come from its own spec.
    # Returns null (not a match) so the caller falls back to normal
    # cell handling - never throws.
    parseMulticolumn: (text) ->
        m = text.match /^\s*\\multicolumn\b/
        return null if not m
        i = m[0].length
        skip = !->
            while text[i] == ' ' or text[i] == '\t' or text[i] == '\n' or text[i] == '\r'
                i = i + 1
        skip!
        return null if text[i] != '{'
        r = @readBalancedGroup text, i
        nText = r[0]
        i = r[1]
        skip!
        return null if text[i] != '{'
        r = @readBalancedGroup text, i
        specText = r[0]
        i = r[1]
        skip!
        return null if text[i] != '{'
        r = @readBalancedGroup text, i
        content = r[0]
        n = (parseInt nText.trim!, 10) or 1
        subcols = @parseColspec specText
        align = if subcols.length > 0 then subcols[0].align else 'c'
        borderLeft = subcols.length > 0 and subcols[0].borderLeft
        borderRight = subcols.length > 0 and subcols[subcols.length - 1].borderRight
        { n: n, align: align, borderLeft: borderLeft, borderRight: borderRight, content: content }

    # Raw body -> array of { cells: [source], hline }. Splits on
    # \\ / \tabularnewline (rows) and & (cells) only at brace depth 0,
    # outside nested environments and inline math. \\-escaped chars,
    # comments, and nested \begin..\end are copied through verbatim.
    splitTabularBody: (raw) ->
        rows = []
        cells = []
        cur = ''
        depth = 0
        env = 0
        math = false
        i = 0
        n = raw.length
        isLetter = (ch) -> ch? and /[a-zA-Z]/.test ch
        endCell = !->
            cells.push cur
            cur := ''
        endRow = !->
            endCell!
            rows.push { cells: cells.slice! }
            cells := []
        while i < n
            c = raw[i]
            if c == '\\'
                d = raw[i + 1]
                if d == '\\'
                    if depth == 0 and env == 0 and not math
                        i = i + 2
                        i = i + 1 if raw[i] == '*'
                        if raw[i] == '['
                            while i < n and raw[i] != ']'
                                i = i + 1
                            i = i + 1 if i < n
                        endRow!
                    else
                        cur += '\\\\'
                        i = i + 2
                else
                    # control word (letters) or a single control symbol
                    j = i + 1
                    if isLetter raw[j]
                        while j < n and isLetter raw[j]
                            j = j + 1
                        word = raw.substring i + 1, j
                    else
                        word = raw[j] ? ''
                        j = j + 1
                    if word == 'begin'
                        env = env + 1
                        cur += '\\' + word
                    else if word == 'end'
                        env = env - 1 if env > 0
                        cur += '\\' + word
                    else if word == 'tabularnewline' and depth == 0 and env == 0 and not math
                        endRow!
                    else
                        cur += '\\' + word
                    i = j
            else if c == '%'
                while i < n and raw[i] != '\n'
                    i = i + 1
            else if c == '{'
                depth = depth + 1
                cur += c
                i = i + 1
            else if c == '}'
                depth = depth - 1 if depth > 0
                cur += c
                i = i + 1
            else if c == '$'
                math = not math
                cur += c
                i = i + 1
            else if c == '&' and depth == 0 and env == 0 and not math
                endCell!
                i = i + 1
            else
                cur += c
                i = i + 1
        # flush a trailing non-empty cell/row (body without a final \\)
        endRow! if cur.trim!.length > 0 or cells.length > 0
        @finalizeTabularRows rows

    # Pull a leading run of rule tokens off each row into per-row flags. A
    # row that is only rules (all cells empty) - whether it's an isolated
    # rule bounded by \\ on both sides, or a trailing rule right before
    # \end - is not an empty data row: hline/toprule/midrule/bottomrule
    # attach as a bottom border on the PREVIOUS row (mirroring the row
    # they visually sit under), while cmidrule/cline ranges carry FORWARD
    # to the NEXT data row's cells (they mark what follows, per \cmidrule's
    # own semantics). A rule with no row on the relevant side is inert,
    # same as an unmatched leading/trailing rule always was.
    finalizeTabularRows: (rows) ->
        out = []
        pendingCmidrules = []
        for row in rows
            res = { hline: false, toprule: false, midrule: false, bottomrule: false, cmidrules: [] }
            if row.cells.length > 0
                res = @stripLeadingRules row.cells[0]
                row.cells[0] = res.rest
            allEmpty = row.cells.every (x) -> x.trim!.length == 0
            if allEmpty
                pendingCmidrules = pendingCmidrules.concat res.cmidrules
                if out.length > 0
                    prev = out[out.length - 1]
                    prev.bottomHline = true if res.hline
                    prev.bottomrule = true if res.bottomrule
                    prev.bottomMidrule = true if res.midrule
                    prev.bottomToprule = true if res.toprule
            else
                cmidrules = pendingCmidrules.concat res.cmidrules
                pendingCmidrules := []
                out.push { cells: row.cells, hline: res.hline, toprule: res.toprule, midrule: res.midrule, bottomrule: res.bottomrule, cmidrules: cmidrules }
        out

    # Matches, in any order, a leading run of \hline, \toprule, \midrule,
    # \bottomrule, and \cmidrule[(trim)]{a-b} / \cline{a-b} (a single
    # number means a-a). Unmatched text is left as the row's own content.
    stripLeadingRules: (text) ->
        s = text
        hline = false
        toprule = false
        midrule = false
        bottomrule = false
        cmidrules = []
        loop
            m = s.match /^\s*\\hline\b/
            if m
                hline := true
                s := s.substring m.0.length
                continue
            m = s.match /^\s*\\toprule\b/
            if m
                toprule := true
                s := s.substring m.0.length
                continue
            m = s.match /^\s*\\midrule\b/
            if m
                midrule := true
                s := s.substring m.0.length
                continue
            m = s.match /^\s*\\bottomrule\b/
            if m
                bottomrule := true
                s := s.substring m.0.length
                continue
            m = s.match /^\s*\\cmidrule\b(?:\s*\([^)]*\))?\s*\{\s*(\d+)\s*(?:-\s*(\d+))?\s*\}/
            if m
                start = parseInt m[1], 10
                cmidrules.push { start: start, end: (if m[2] then parseInt m[2], 10 else start) }
                s := s.substring m[0].length
                continue
            m = s.match /^\s*\\cline\b\s*\{\s*(\d+)\s*(?:-\s*(\d+))?\s*\}/
            if m
                start = parseInt m[1], 10
                cmidrules.push { start: start, end: (if m[2] then parseInt m[2], 10 else start) }
                s := s.substring m[0].length
                continue
            break
        { hline: hline, toprule: toprule, midrule: midrule, bottomrule: bottomrule, cmidrules: cmidrules, rest: s }

    # Build <table class="latex-tabular"> from the raw spec + body. Each
    # cell reparses through the tolerant fragment path. \multicolumn cells
    # take their own colspan/alignment/borders from their own spec instead
    # of the table's; cmidrule/cline ranges mark specific physical columns
    # of the row they prefix (clamped by simple range comparison, never by
    # array indexing, so an out-of-range a-b just matches nothing extra).
    renderTabular: (spec, body, name) ->
        cols = @parseColspec spec
        rows = @splitTabularBody body
        table = document.createElement 'table'
        table.setAttribute 'class', 'latex-tabular'
        for row in rows
            tr = document.createElement 'tr'
            cls = []
            cls.push 'latex-hline' if row.hline
            cls.push 'latex-hline-bottom' if row.bottomHline
            cls.push 'latex-toprule' if row.toprule
            cls.push 'latex-midrule' if row.midrule
            cls.push 'latex-bottomrule' if row.bottomrule
            cls.push 'latex-toprule-bottom' if row.bottomToprule
            cls.push 'latex-midrule-bottom' if row.bottomMidrule
            tr.setAttribute 'class', cls.join ' ' if cls.length > 0
            physCol = 0
            for cell in row.cells
                source = cell.trim!
                mc = @parseMulticolumn source
                if mc
                    col = { align: mc.align, borderLeft: mc.borderLeft, borderRight: mc.borderRight }
                    span = if mc.n > 0 then mc.n else 1
                    cellSource = mc.content
                else
                    col = if physCol < cols.length then cols[physCol] else cols[cols.length - 1]
                    span = 1
                    cellSource = source
                td = document.createElement 'td'
                tdcls = [ 'latex-col-' + (col?.align or 'l') ]
                tdcls.push 'latex-vline-left' if col?.borderLeft
                tdcls.push 'latex-vline-right' if col?.borderRight
                cellStart = physCol + 1
                cellEnd = physCol + span
                marked = row.cmidrules and row.cmidrules.some (r) -> cellStart <= r.end and cellEnd >= r.start
                tdcls.push 'latex-cmidrule' if marked
                td.setAttribute 'class', tdcls.join ' '
                td.setAttribute 'colspan', "#{span}" if span > 1
                @appendCellContent td, cellSource
                tr.appendChild td
                physCol := physCol + span
            table.appendChild tr
        table

    # Reparse a cell's source and append it to td, unwrapping a lone
    # wrapping <p> - whether returned directly (createFragment's own
    # single-node shortcut) or as the sole child of an actual fragment -
    # so cell content stays inline instead of carrying block margins.
    appendCellContent: (td, source) !->
        return if not source
        node = @reparse source
        return if not node
        isP = (n) -> n? and (n.nodeName ? '').toLowerCase! == 'p'
        if isP node
            while node.firstChild
                td.appendChild node.firstChild
        else if (node.nodeName ? '').toLowerCase! == '#document-fragment' and node.childNodes.length == 1 and isP node.firstChild
            p = node.firstChild
            while p.firstChild
                td.appendChild p.firstChild
        else
            td.appendChild node


    location: !-> error "location function not set!"



    # set the title of the document, usually called by the \maketitle macro
    setTitle: (title) ->
        @documentTitle = title?.textContent



    ### characters

    hasSymbol: (name) ->
        Macros.symbols.has name

    symbol: (name) ->
        @error "no such symbol: #{name}" if not @hasSymbol name
        Macros.symbols.get name



    ### macros

    hasMacro: (name) ->
        typeof @_macros[name] == "function"
        and name !== "constructor"
        and (@_macros.hasOwnProperty name or Macros.prototype.hasOwnProperty name)

    argsFor: (m) -> if @_userArgs? and @_userArgs[m]? then @_userArgs[m] else Macros.args[m]

    defineMacro: (name, argSpec, impl) !->
        @_userArgs[name] = argSpec
        @_macros[name] = impl

    defineUserCommand: (name, nargs, def, body, mode) !->
        return if not name
        cs = ("" + name).replace /^\\/, ""
        return if not cs
        exists = @hasMacro(cs) or @_katexMacros["\\" + cs]?
        return if mode == \provide and exists
        n = if nargs? then (parseInt (("" + nargs).replace /[^0-9]/g, ""), 10) or 0 else 0
        body ?= ""
        # KaTeX rejects custom xcolor names (e.g. blind_magenta -- underscore +
        # not a built-in colour), erroring the whole formula. Strip \color
        # switches from the math-mode (KaTeX) expansion so colour macros render
        # uncoloured instead of red-erroring. Text-mode expansion keeps colour.
        @_katexMacros["\\" + cs] = body.replace(/\\color\s*\{[^}]*\}/g, "")
        # Generator-side (text-mode) expansion is for genuinely new commands
        # or our own earlier user macros only. Redefining a BUILT-IN (an
        # environment like enumerate, a programmatic macro like \theenumi)
        # through the reparse path corrupts its mode and crashes the env
        # machinery; leave built-ins to their native impl - math usage is
        # still honored via the KaTeX macro registered above.
        return if @hasMacro(cs) and not @_userArgs?[cs]?

        # Alias pattern, e.g. \newcommand{\nc}{\newcommand}: \nc's body is a
        # bare definer control sequence and it takes no args, so \nc{..}{..}
        # is meant to behave like that definer. Reparsing the body alone
        # cannot capture the trailing {name}{def} args, so alias \nc straight
        # to the definer's argspec + behaviour instead.
        if n == 0 and body?
            bt = body.trim!
            bs = String.fromCharCode 92
            aliasMode = null
            aliasMode := \new     if bt == bs + "newcommand"
            aliasMode := \renew   if bt == bs + "renewcommand"
            aliasMode := \provide if bt == bs + "providecommand"
            if aliasMode?
                g0 = this
                @defineMacro cs, <[ HV m n? rg? rg ]>, (nm, na, df, bd) !-> g0.defineUserCommand nm, na, df, bd, aliasMode
                return

        g = this
        spec = [\H]
        if def?
            spec.push \rg?
            for i from 2 to n
                spec.push \rg
        else
            for i from 1 to n
                spec.push \rg
        @defineMacro cs, spec, (...rawArgs) ->
            g._expandDepth = (g._expandDepth or 0) + 1
            if g._expandDepth > 80
                g._expandDepth -= 1
                return [ g.unsupportedNode \newcommand, cs, "macro expansion too deep (recursion?)" ]
            expanded = body
            for i from 1 to n
                a = rawArgs[i - 1]
                a = def if i == 1 and def? and not a?
                a ?= ""
                expanded := expanded.replace (new RegExp "#" + i, "g"), a
            out = g.reparse expanded
            g._expandDepth -= 1
            # unwrap a lone wrapping <p> so an inline text macro doesn't
            # inject paragraph breaks mid-sentence
            if out and (out.nodeName ? "").toLowerCase! == \p
                inline = g.createFragment!
                while out.firstChild
                    inline.appendChild out.firstChild
                return [ inline ]
            [ out ]

    # \DeclareMathOperator target: write straight into the KaTeX macro map,
    # skipping defineUserCommand entirely. An operator body (e.g. "arg\,max")
    # must reach KaTeX byte for byte - defineUserCommand's \color-strip is
    # harmless here (operator bodies don't carry \color) but it also treats
    # the name as a reparse target and registers a text-mode expansion,
    # neither of which an operator needs.
    defineMathOperator: (name, body, starred) !->
        op = if starred then "\\operatorname*" else "\\operatorname"
        @_katexMacros["\\" + name] = op + "{" + body + "}"

    defineTheorem: (env, shared, title, parent, numbered) !->
        return if not env
        sharedName = shared?.textContent?.trim!
        parentName = parent?.textContent?.trim!
        counter = sharedName or env
        if numbered and not sharedName and not @hasCounter counter
            if parentName then @newCounter counter, parentName else @newCounter counter
        name = (title?.textContent or env)
        @_crefNames[counter] = name.toLowerCase! if numbered
        g = this
        @defineMacro env, <[ V o? ]>, (note) ->
            if numbered
                id = "thm-" + g.nextId!
                g.stepCounter counter
                g.refCounter counter, id
            parts = [ g.createText(name) ]
            if numbered
                parts.push g.createText(" ")
                parts.push ...g.macro(\the + counter)
            parts.push g.createText(if note then " (#{note.textContent})." else ".")
            headEl = g.create g.inline, g.createFragment(parts), "theorem-head"
            el = g.create g.block, headEl, "theorem"
            el.id = id if numbered
            [el]
        @defineMacro ("end" + env), <[ V ]>, -> []

    isHmode:    (marco) -> @argsFor(marco)?.0 == \H  or not @argsFor(marco)
    isVmode:    (marco) -> @argsFor(marco)?.0 == \V
    isHVmode:   (marco) -> @argsFor(marco)?.0 == \HV
    isPreamble: (marco) -> @argsFor(marco)?.0 == \P

    # A macro defined at runtime via \newcommand/\newtheorem (tracked in
    # @_userArgs). Built-ins are not in @_userArgs. Used so the preamble
    # loop expands a paper's own macros there - many papers define their
    # notation via meta-macros (\newcommand whose body is a \newcommand)
    # invoked in the preamble; without this those targets never get defined.
    isUserMacro: (marco) -> @_userArgs?[marco]?

    # Convert a LaTeX width/height (raw, e.g. from a {..} box arg) to a valid
    # CSS dimension: \textwidth/\columnwidth/\linewidth-relative -> percent of
    # the container; absolute CSS units pass through; bp -> pt; else null.
    cssDimen: (v) ->
        return null if not v?
        s = (v + "").trim!
        bs = String.fromCharCode 92
        for kw in <[ textwidth columnwidth linewidth hsize ]>
            idx = s.indexOf(bs + kw)
            if idx >= 0
                num = s.slice(0, idx).trim!
                n = if num == "" then 1 else parseFloat(num)
                return "#{if isNaN(n) then 100 else n * 100}%"
        if s.match(/^[\d.]+\s*(cm|mm|in|pt|pc|px|em|ex|rem|%)$/)
            return s
        if m = s.match(/^([\d.]+)\s*bp$/)
            return "#{m.1}pt"
        null

    macro: (name, args) ->
        if symbols.has name
            return [ @createText symbols.get name ]

        # Flagged defined yet no callable impl (e.g. a list level past
        # the 4 LaTeX.js defines, reached after tolerant over-deep
        # nesting). Record telemetry; emit nothing visible (internal
        # artifact, not a user construct).
        if typeof @_macros[name] != 'function'
            if @_options?.tolerant
                @reportDegradation \unknown-macro, name, "\\#{name} has no implementation"
                return []
            error "no such macro: \\#{name}"
            return []

        invoke = ~>
            @_macros[name]
                .apply @_macros, args
                ?.filter (x) -> x !~= undefined
                .map (x) ~> if typeof x == 'string' or x instanceof String then @createText x else @addAttributes x

        return invoke! if not @_options?.tolerant

        # Seam A: a handler that throws at runtime is contained to a
        # placeholder so the rest of the document still renders.
        try
            invoke!
        catch e
            [ @unsupportedNode \macro-threw, name, "\\#{name}: #{e.message}" ]


    # macro arguments

    beginArgs: (macro) !->
        decl = @argsFor macro
        @_curArgs.push if decl
            then {
                name: macro
                args: decl.slice(1)
                parsed: []
                failed: false
            } else {
                args: []
                parsed: []
                failed: false
            }

    # if next char matches the next arg of a branch, choose that branch
    # return true if there was a matched branch, false otherwise
    selectArgsBranch: (nextChar) ->
        optArgs = <[ o? i? k? kv? n? l? c-ml? cl? ]>

        if Array.isArray @_curArgs.top.args.0
            # check which alternative branch to choose, discard the others only if it was a match
            branches = @_curArgs.top.args.0
            for b in branches
                if (nextChar == '[' and b.0 in optArgs) or (nextChar == '{' and b.0 not in optArgs)
                    @_curArgs.top.args.shift!           # remove all branches
                    @_curArgs.top.args.unshift ...b     # prepend remaining args

                    return true


    # check the next argument type to parse, returns true if arg is the next expected argument
    # if the next expected argument is an array, it is treated as a list of alternative next arguments
    nextArg: (arg) ->
        if @_curArgs.top.args.0 == arg
            @_curArgs.top.args.shift!
            true

    argError: (m) ->
        # Strict mode: a known macro fed args that do not fit its spec
        # is a hard error. Tolerant mode: flag the failure so the macro
        # grammar rule re-emits the macro as an unsupported placeholder
        # instead of aborting the whole document.
        if @_options?.tolerant
            @_curArgs.top.failed = true
            return false
        error "macro \\#{@_curArgs.top.name}: #{m}"
        return false

    argsFailed: ->
        # Two ways a known macro's arguments can fail: argError set the
        # flag, or the arg loop ended with declared args still unparsed
        # (it shifts an arg off before the parser runs, so a failed
        # mandatory arg can leave either signal).
        @_curArgs.top? and (!!@_curArgs.top.failed or @_curArgs.top.args.length != 0)

    # add the result of a parsed argument
    addParsedArg: (a) !->
        @_curArgs.top.parsed.push a

    # get the parsed arguments so far
    parsedArgs: ->
        @_curArgs.top.parsed

    # execute macro with parsed arguments so far
    preExecMacro: !->
        @macro @_curArgs.top.name, @parsedArgs!

    # remove arguments of a completely parsed macro from the stack
    endArgs: !->
        @_curArgs.pop!
            ..args.length == 0 || @_options?.tolerant || error "grammar error: arguments for #{..name} have not been parsed: #{..args}"
            return ..parsed


    ### environments

    begin: (env_id) !->
        if not @hasMacro env_id
            if @_options?.tolerant
                # Register a chip-emitting begin + no-op end so the env
                # body still parses + renders. The begin closure is
                # bound (~>) to this generator, not @_macros (macro()
                # invokes handlers via .apply @_macros, ...), and reports
                # the degradation on every call - i.e. once per
                # occurrence, same as unknownMacro - not just once at
                # registration. It returns [chip, emptyFragment] rather
                # than [chip] alone: h_environment/environment splice
                # the env body INTO the last returned node when that
                # node is an element, and the chip must stay standalone
                # with the body flowing after it as plain siblings.
                console.warn "tolerant: unknown environment '#{env_id}'"
                @_macros[env_id]          = ~> [ @envChipNode(env_id), @createFragment! ]
                @_macros["end" + env_id]  = -> []
            else
                error "unknown environment: #{env_id}"

        @startBalanced!
        @enterGroup!
        @beginArgs env_id


    end: (id, end_id) ->
        # Tolerant: an env closed by a mismatched \end (e.g. recovery
        # inside an unknown env grabbed a nested \end) recovers by
        # accepting the close instead of aborting the whole document.
        if id != end_id and not @_options?.tolerant
            error "environment '#{id}' is missing its end, found '#{end_id}' instead"

        if @hasMacro "end" + id
            end = @macro "end" + id

        @exitGroup!
        @isBalanced! or @_options?.tolerant or error "#{id}: groups need to be balanced in environments!"
        @endBalanced!

        end



    ### groups

    # start a new group
    enterGroup: (copyAttrs = false) !->
        # shallow copy of the contents of top is enough because we don't change the elements, only the array and the maps
        @_stack.push {
            attrs: if copyAttrs then Object.assign {}, @_stack.top.attrs else {}
            align: null                                                 # alignment is set only per level where it was changed
            currentlabel: Object.assign {}, @_stack.top.currentlabel
            lengths: new Map(@_stack.top.lengths)
        }
        ++@_groups.top

    # end the last group - throws if there was no group to end
    exitGroup: !->
        if --@_groups.top < 0
            # Group underflow (an extra }/\egroup the preamble or body
            # left unbalanced). Strict mode throws; tolerant mode clamps
            # and keeps going rather than aborting the document.
            error "there is no group to end here" if not @_options?.tolerant
            @_groups.top = 0
            return
        @_stack.pop!

    # Track nesting inside optional [..] arguments so the tolerant
    # parser can tell a literal ] (inside a {} group, e.g.
    # \textcolor{red}{[note]}) from a ] that closes an optional arg.
    enterOptarg: !-> @_optDepth = (@_optDepth || 0) + 1
    exitOptarg:  !-> @_optDepth = (@_optDepth || 0) - 1
    inOptarg:     -> (@_optDepth || 0) > 0

    # start a new level of grouping
    startBalanced: !->
        @_groups.push 0

    # exit a level of grouping and return the levels of balancing still left
    endBalanced: ->
        @_groups.pop!
        @_groups.length

    # check if the current level of grouping is balanced
    isBalanced: ->
        @_groups.top == 0


    ### attributes - in HTML, those are CSS classes

    continue: !->
        @_continue = @location!.end.offset

    break: !->
        # only record the break if it came from a position AFTER the continue
        if @location!.end.offset > @_continue
            @_continue = false


    # alignment

    setAlignment: (align) !->
        @_stack.top.align = align

    alignment: ->
        @_stack.top.align


    # font attributes

    setFontFamily: (family) !->
        @_stack.top.attrs.fontFamily = family

    setFontWeight: (weight) !->
        @_stack.top.attrs.fontWeight = weight

    setFontShape: (shape) !->
        if shape == "em"
            if @_activeAttributeValue("fontShape") == "it"
                shape = "up"
            else
                shape = "it"

        @_stack.top.attrs.fontShape = shape

    setFontSize: (size) !->
        @_stack.top.attrs.fontSize = size

    setTextDecoration: (decoration) !->
        @_stack.top.attrs.textDecoration = decoration


    # get all inline attributes of the current group
    _inlineAttributes: ->
        cur = @_stack.top.attrs
        [cur.fontFamily, cur.fontWeight, cur.fontShape, cur.fontSize, cur.textDecoration].join(' ').replace(/\s+/g, ' ').trim!

    # get the currently active value for a specific attribute, also taking into account inheritance from parent groups
    # return the empty string if the attribute was never set
    _activeAttributeValue: (attr) ->
        # from top to bottom until the first value is found
        for level from @_stack.length-1 to 0 by -1
            if @_stack[level].attrs[attr]
                return that




    ### sectioning

    startsection: (sec, level, star, toc, ttl) ->
        # call before the arguments are parsed to refstep the counter
        if toc ~= ttl ~= undefined
            if not star and @counter("secnumdepth") >= level
                @stepCounter sec
                @refCounter sec, "sec-" + @nextId!

            return

        # number the section?
        if not star and @counter("secnumdepth") >= level
            if sec == \chapter
                chaphead = @create @block, @macro(\chaptername) ++ (@createText @symbol \space) ++ @macro(\the + sec)
                el = @create @[sec], [chaphead, ttl]
            else
                el = @create @[sec], @macro(\the + sec) ++ (@createText @symbol \quad) ++ ttl   # in LaTeX: \@seccntformat

            # take the id from currentlabel.id
            el.id? = @_stack.top.currentlabel.id
        else
            el = @create @[sec], ttl

        # entry in the TOC required?
        # if not star and @counter("tocdepth")
        #     TODO

        el

    ### lists

    startlist: ->
        @stepCounter \@listdepth
        if @counter(\@listdepth) > 6 and not @_options?.tolerant
            error "too deeply nested"

        true

    endlist: !->
        @setCounter \@listdepth, @counter(\@listdepth) - 1
        @continue!



    ### lengths


    newLength: (l) !->
        error "length #{l} already defined!" if @hasLength l
        @_stack.top.lengths.set l, @Length.zero

    hasLength: (l) ->
        @_stack.top.lengths.has l

    setLength: (id, length) !->
        # Unknown lengths (\topskip and other engine/class lengths
        # LaTeX.js does not define) abort in strict mode; tolerant mode
        # auto-creates them so \setlength keeps the document rendering.
        if not @hasLength id
            error "no such length: #{id}" if not @_options?.tolerant
            console.warn "tolerant: auto-creating unknown length #{id}"
        @_stack.top.lengths.set id, length

    length: (l) ->
        if not @hasLength l
            error "no such length: #{l}" if not @_options?.tolerant
            console.warn "tolerant: reading unknown length #{l} as 0"
            return @Length.zero
        @_stack.top.lengths.get l

    theLength: (id) ->
        l = @create @inline, undefined, "the"
        l.setAttribute "display-var", id
        l





    ### LaTeX counters (global)

    newCounter: (c, parent) !->
        error "counter #{c} already defined!" if @hasCounter c

        @_counters.set c, 0
        @_resets.set c, []

        if parent
            @addToReset c, parent

        error "macro \\the#{c} already defined!" if @hasMacro(\the + c)
        @_macros[\the + c] = -> [ @g.arabic @g.counter c ]


    hasCounter: (c) ->
        @_counters.has c

    setCounter: (c, v) !->
        if not @hasCounter c
            # \setcounter on a counter LaTeX.js doesn't define (e.g.
            # amsmath's MaxMatrixCols). Strict mode throws; tolerant
            # mode auto-creates it so the value is simply stored and
            # the document keeps rendering.
            error "no such counter: #{c}" if not @_options?.tolerant
            console.warn "tolerant: auto-creating unknown counter #{c}"
        @_counters.set c, v

    stepCounter: (c) !->
        @setCounter c, @counter(c) + 1
        @clearCounter c

    counter: (c) ->
        if not @hasCounter c
            error "no such counter: #{c}" if not @_options?.tolerant
            console.warn "tolerant: reading unknown counter #{c} as 0"
            return 0
        @_counters.get c

    refCounter: (c, id) ->
        # currentlabel is local, the counter is global
        # we need to store the id of the element as well as the counter (\@currentlabel)
        # if no id is given, create a new element to link to
        if not id
            id = c + "-" + @nextId!
            el = @create @anchor id

        # currentlabel stores the id of the anchor to link to, as well as the label to display in a \ref{}
        @_stack.top.currentlabel =
            id: id
            type: c
            label: @createFragment [
                ...if @hasMacro(\p@ + c) then @macro(\p@ + c) else []
                ...@macro(\the + c)
            ]

        return el


    addToReset: (c, parent) !->
        error "no such counter: #{parent}" if not @hasCounter parent
        error "no such counter: #{c}" if not @hasCounter c
        @_resets.get parent .push c

    # reset all descendants of c to 0
    clearCounter: (c) !->
        for r in @_resets.get(c) || []
            @clearCounter r
            @setCounter r, 0


    # formatting counters

    alph: (num) -> String.fromCharCode(96 + num)

    Alph: (num) -> String.fromCharCode(64 + num)

    arabic: (num) -> String(num)

    roman: (num) ->
        lookup =
            * \m,  1000
            * \cm, 900
            * \d,  500
            * \cd, 400
            * \c,  100
            * \xc, 90
            * \l,  50
            * \xl, 40
            * \x,  10
            * \ix, 9
            * \v,  5
            * \iv, 4
            * \i,  1

        _roman num, lookup

    Roman: (num) ->
        lookup =
            * \M,  1000
            * \CM, 900
            * \D,  500
            * \CD, 400
            * \C,  100
            * \XC, 90
            * \L,  50
            * \XL, 40
            * \X,  10
            * \IX, 9
            * \V,  5
            * \IV, 4
            * \I,  1

        _roman num, lookup


    _roman = (num, lookup) ->
        roman = ""

        for i in lookup
            while num >= i[1]
                roman += i[0]
                num -= i[1]

        return roman

    fnsymbol: (num) ->
        switch num
        |   1   => @symbol \textasteriskcentered
        |   2   => @symbol \textdagger
        |   3   => @symbol \textdaggerdbl
        |   4   => @symbol \textsection
        |   5   => @symbol \textparagraph
        |   6   => @symbol \textbardbl
        |   7   => @symbol(\textasteriskcentered) + @symbol \textasteriskcentered
        |   8   => @symbol(\textdagger) + @symbol \textdagger
        |   9   => @symbol(\textdaggerdbl) + @symbol \textdaggerdbl
        |   _   =>
            # \fnsymbol is often defined while the counter is still 0
            # (e.g. \renewcommand{\thefootnote}{\fnsymbol{footnote}});
            # the real symbol is only needed once the counter steps to
            # 1-9. Tolerant mode returns empty for out-of-range instead
            # of aborting the document.
            error "fnsymbol value must be between 1 and 9" if not @_options?.tolerant
            ""


    ### label, ref

    # Undo the renderer's typographic transforms (hyphen variants,
    # ligatures) so a label stored raw from an equation math body matches
    # a ref/cref whose key arrives via already-rendered textContent.
    canonicalLabel: (s) ->
        return s if typeof s != \string
        out = ""
        for ch in s.split ""
            out += switch ch.charCodeAt 0
                | 0x2010, 0x2011 => "-"
                | 0xFB00 => "ff"
                | 0xFB01 => "fi"
                | 0xFB02 => "fl"
                | 0xFB03 => "ffi"
                | 0xFB04 => "ffl"
                | otherwise => ch
        out

    # labels are possible for: parts, chapters, all sections, \items, footnotes, minipage-footnotes, tables, figures
    setLabel: (label) !->
        label = @canonicalLabel label
        # A duplicate \label is a warning in real LaTeX, not fatal.
        # Tolerant mode keeps the first definition and carries on
        # (the body-recovery skip can also re-feed a label).
        if @_labels.has label
            error "label #{label} already defined!" if not @_options?.tolerant
            console.warn "tolerant: duplicate label #{label}"
            return

        if not @_stack.top.currentlabel.id
            console.warn "warning: no \\@currentlabel available for label #{label}!"

        @_labels.set label, @_stack.top.currentlabel

        # fill forward references
        if @_refs.has label
            for r in @_refs.get label
                while r.firstChild
                    r.removeChild r.firstChild

                r.appendChild @_stack.top.currentlabel.label.cloneNode true
                r.setAttribute "href", "#" + @_stack.top.currentlabel.id

            @_refs.delete label

    # keep a reference to each ref element if no label is known yet, then as we go along, fill it with labels
    ref: (label) ->
        label = @canonicalLabel label
        # href is the element id, content is \the<counter>
        if @_labels.get label
            return @create @link("#" + that.id), that.label.cloneNode true

        el = @create (@link "#"), @createText "??"

        if not @_refs.has label
            @_refs.set label, [el]
        else
            @_refs.get label .push el

        el


    # number the current equation, anchor it, and register any \label
    # names pulled from the equation body. Returns the anchor id.
    equationLabel: (labels) ->
        @stepCounter \equation
        id = "eq-" + @nextId!
        @refCounter \equation, id      # currentlabel = { id, label: \theequation }
        for n in labels when n.length
            @setLabel n
        id

    # Split a multi-line math body on its top-level row breaks (\\),
    # leaving \\ nested in braces or an inner environment
    # (cases/matrix/substack/aligned/...) untouched.
    splitMathRows: (body) ->
        rows = []; cur = ""; depth = 0; i = 0; len = body.length
        while i < len
            if body.substr(i, 2) == "\\\\"
                if depth == 0
                    rows.push cur; cur = ""; i += 2
                    if body.charAt(i) == "["
                        k = body.indexOf "]", i
                        i = if k >= 0 then k + 1 else i
                else
                    cur += "\\\\"; i += 2
            else if body.substr(i, 2) == "\\{" or body.substr(i, 2) == "\\}"
                cur += body.substr i, 2; i += 2
            else if body.charAt(i) == "\\"
                word = (/^\\([a-zA-Z]+)/.exec body.slice i)?.1 or ""
                depth++ if word == "begin"
                depth-- if word == "end" and depth > 0
                seg = if word then "\\" + word else body.substr i, 2
                cur += seg; i += seg.length
            else
                ch = body.charAt i
                depth++ if ch == "{"
                depth-- if ch == "}" and depth > 0
                cur += ch; i++
        rows.push cur
        rows

    # Number a multi-line math env (align/eqnarray/gather) row by row: a
    # row without \nonumber/\notag steps the equation counter and gets a
    # \tag{N}; its \label(s) register at N. All rows share one block anchor
    # (KaTeX renders the env as one block, so a \ref lands on the block).
    numberMathRows: (body) ->
        blockId = "eq-" + @nextId!
        anchored = false
        out = []
        for row in @splitMathRows body
            if /\\(?:nonumber|notag)\b/.test row
                out.push row.replace(/\\label\s*\{[^}]*\}/g, "")
            else
                @stepCounter \equation
                @refCounter \equation, blockId
                num = @counter \equation
                labels = []
                r = row.replace /\\label\s*\{([^}]*)\}/g, (_, l) ->
                    labels.push l.trim!
                    ""
                for l in labels when l.length
                    @setLabel l
                    anchored := true
                out.push r + " \\tag{" + num + "}"
        body: out.join " \\\\ "
        id:   if anchored then blockId else null

    # set the id on the first element node of a rendered fragment, so a
    # \ref to the equation lands on its rendered block
    setNodeId: (frag, id) !->
        return if not frag
        node = frag.firstChild
        while node and node.nodeType != 1
            node = node.nextSibling
        node.id = id if node


    # cref display name for a label type. Defaults to the type/counter
    # name itself (equation -> "equation", figure -> "figure", section ->
    # "section"); overridable via @_crefNames (theorems register a title).
    crefName: (type) ->
        @_crefNames[type] or type

    # cleveref-style typed reference: "<name> <numberlink>". cap=true
    # capitalizes the name (\Cref). Equation types parenthesize the
    # number (matching \eqref). Unknown/undefined label -> fall back to a
    # bare \ref (number link / ??, no name) so it never throws.
    cref: (label, cap) ->
        label = @canonicalLabel label
        entry = @_labels.get label
        return @ref label if not entry or not entry.type
        name = @crefName entry.type
        name = name.charAt(0).toUpperCase() + name.slice(1) if cap
        link = @create (@link "#" + entry.id), entry.label.cloneNode true
        inner =
            if entry.type == \equation
                [ @createText("#{name} ("), link, @createText(")") ]
            else
                [ @createText("#{name} "), link ]
        @create @inline, inner, "cref"


    # figure/table environments set the caption type so \caption knows
    # which counter to step. No float positioning - rendered inline as a block.
    beginFloat: (type) !->
        @_captionType = type

    endFloat: !->
        @_captionType = null

    # \caption: number the current float, anchor it (so \label/\ref/\cref
    # land on the caption), and render "Figure N: <text>". Outside a float
    # (@_captionType null) just render the text, no number, no throw.
    caption: (txt) ->
        type = @_captionType
        return @create @block, txt, "caption" if not type
        @stepCounter type
        id = type + "-" + @nextId!
        @refCounter type, id
        name = type.charAt(0).toUpperCase() + type.slice(1)
        head = @createFragment [ @createText("#{name} "), ...@macro(\the + type), @createText(": ") ]
        el = @create @block, [ head, txt ], "caption"
        el.id = id
        el


    logUndefinedRefs: !->
        return if @_refs.size == 0

        keys = @_refs.keys!
        while not (ref = keys.next!).done
            console.warn "warning: reference '#{ref.value}' undefined"

        console.warn "There were undefined references."


    # citations: assign a number on first encounter (appearance order)
    # and return { id, n }. \cite renders the number + a link to #id;
    # the reference list (\bibliography) is built later from this map.
    citation: (key) ->
        return that if @_citations.get key
        entry = { id: "cite-" + key, n: @_citations.size + 1 }
        @_citations.set key, entry
        entry

    # build the node for \cite{k1,k2}: each key -> a link whose text is
    # its appearance-order number. bracketed wraps the group in [ ]
    # (\cite, \citep); \citet (in-text) omits the brackets.
    cite: (keys, bracketed) ->
        children = []
        first = true
        for raw in keys.split ","
            k = raw.trim!
            continue if not k
            children.push @createText ", " if not first
            first := false
            c = @citation k
            children.push @create (@link "#" + c.id), @createText String c.n
        if bracketed
            children.unshift @createText "["
            children.push @createText "]"
        @create @inline, children, "cite"


    # \bibliography{names}: read each "<name>.bib" via the host readFile
    # callback, parse, and render a "References" list of the CITED keys
    # in appearance order. A cited key absent from the .bib is still
    # anchored (so its \cite link lands) and recorded as a degradation.
    # No readFile / no .bib content -> one bibliography degradation and
    # no list (the \cite links remain, dangling but visible).
    bibliography: (names) ->
        read = @_options?.readFile
        entries = {}
        found = false
        if typeof read == "function"
            for raw in names.split ","
                name = raw.trim!
                continue if not name
                name += ".bib" if not /\.bib$/i.test name
                content = read name
                continue if not content
                found := true
                try
                    for e in bibtexParse.toJSON content
                        key = (e.citationKey || "").toLowerCase!
                        entries[key] = e if key
                catch
                    void

        if not found
            return @unsupportedNode \bibliography, "bibliography",
                "no .bib content available via readFile"

        cited = Array.from @_citations.entries!
        cited.sort (a, b) -> a.1.n - b.1.n
        items = for [key, c] in cited
            e = entries[key.toLowerCase!]
            li = @create "li", @formatBibEntry_ key, e
            li.id = c.id
            if not e
                li.setAttribute "data-unresolved", ""
                @reportDegradation \cite, key, "cited key not in .bib"
            li
        list = @create "ol", items, "latex-bibliography"
        @createFragment (@create "h2", @createText "References"), list

    # Plain "Authors. Title. Journal/Booktitle. Year." join (browsability
    # over style fidelity). Missing entry -> the bare key so the line is
    # not empty. Field lookup is case-insensitive via a lowercased map.
    formatBibEntry_: (key, e) ->
        return @createText key if not e
        t = e.entryTags || {}
        lower = {}
        for own k of t
            lower[k.toLowerCase!] = t[k]
        parts = [lower.author, lower.title, (lower.journal || lower.booktitle), lower.year]
        text = parts.filter((x) -> x?).join ". "
        @createText (if text then text + "." else key)


    ### marginpar

    marginpar: (txt) ->
        id = @nextId!

        marginPar = @create @block, [@create(@inline, null, "mpbaseline"), txt]
        marginPar.id = id

        @_marginpars.push marginPar

        marginRef = @create @inline, null, "mpbaseline"
        marginRef.id = "marginref-" + id

        marginRef
