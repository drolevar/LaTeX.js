'use strict'


# Named colors that get an actual CSS class (base.css); xcolor's full
# palette (+ any \definecolor name) is much larger, but an unstyled name
# just renders uncolored rather than guessing a swatch. Exported (not just
# used by XColor below) so the core \textcolor fallback in latex.ltx.ls -
# for documents that skip \usepackage{xcolor} entirely - shares the same
# color list instead of duplicating it.
export namedTextColors = new Set(<[
    black white red green blue cyan magenta yellow gray grey orange purple brown
]>)

# \textcolor's color arg is raw source text (e.g. "red", "gray!30"). A mix
# expression degrades to its base name; anything else unrecognized returns
# null so the caller leaves the content uncolored.
export textColorClass = (name) ->
    base = ((name or "").split "!").0.trim!
    if namedTextColors.has base then "latex-color-" + base else null


export class XColor

    args = @args = {}


    # color data structure:

    # color-name: {
    #     rgb: { r: , g: , b: },
    #     hsb: { },
    #     cmyk: {},
    #     gray:
    # }


    colors = @colors = new Map([
        * "red"             {}
        * "green"           {}
        * "blue"            {}
        * "cyan"            {}
        * "magenta"         {}
        * "yellow"          {}
        * "black"           {}
        * "gray"            {}
        * "white"           {}
        * "darkgray"        {}
        * "lightgray"       {}
        * "brown"           {}
        * "lime"            {}
        * "olive"           {}
        * "orange"          {}
        * "pink"            {}
        * "purple"          {}
        * "teal"            {}
        * "violet"          {}
    ])


    # CTOR
    (generator, options) ->
        @g = generator
        @options = options if options

        for opt in @options
            opt = Object.keys(opt).0

            # xcolor, 2.1.2

            switch opt
            # target color mode
            | "natural" =>
            | "rgb" =>
            | "cmy" =>
            | "cmyk" =>
            | "hsb" =>
            | "gray" =>
            | "RGB" =>
            | "HTML" =>
            | "HSB" =>
            | "Gray" =>
            | "monochrome" =>

            # predefined colors
            | "dvipsnames" =>
            | "dvipsnames*" =>
            | "svgnames" =>
            | "svgnames*" =>
            | "x11names" =>
            | "x11names*" =>

            | otherwise =>



    # defining colors


    # \definecolorset[type]{model-list}{head}{tail}{set spec}
    args.\definecolorset = <[ P i? c-ml ie ie c-ssp ]>
    \definecolorset      : (type, models, hd, tl, setspec) !->
        @g.error "unknown color type" if type not in [null, "named" "ps"]

        hd = "" if not hd
        tl = "" if not tl

        for spec in setspec
            @definecolor type, hd + spec.name + tl, models, spec.speclist

    # \definecolor[type]{name}{model-list}{color spec list}
    args.\definecolor = <[ P i? i c-ml c-spl ]>
    \definecolor      : (type, name, models, colorspec) !->
        @g.error "unknown color type" if type not in [null, "named" "ps"]
        @g.error "color models and specs don't match" if models.models.length != colorspec.length

        color = {}

        # TODO: deal with models.core

        for model, i in models.models
            color[model] = colorspec[i]

        colors.set name, color

        # console.log(name, JSON.stringify(colors.get name))


    # using colors

    # {name/expression} or [model-list]{color spec list}
    args.\color     = [ "HV" [ <[ c-ml? c-spl ]>
                               <[ c ]>            ] ]
    \color          : !->
        if &.length == 1
            console.log "got color expression"
        else
            console.log "got model/color spec"

    # args.\color =       <[ HV c-ml? c-spl ]>
    # \color      : (model, colorspec) ->

    # {name}{text}: named colors only this batch (model-list/spec-list forms
    # are out of scope - unrecognized text just renders uncolored below).
    # The color arg is raw source text ("rg"), not reparsed, so a mix
    # expression like "gray!30" is plain source we can degrade ourselves
    # instead of decoding the color grammar's parsed shape. Mode "H", not
    # "HV": the grammar's hv_macro rule unconditionally discards a macro's
    # return value (fine for pure declarations like \bfseries, wrong for
    # a macro that must render a visible span).
    args.\textcolor = <[ H rg g ]>
    \textcolor      : (name, text) ->
        cls = textColorClass name
        if cls then [ @g.create @g.inline, text, cls ] else [ text ]


    # \colorbox{name}{text}
    # \colorbox[model]{specification}{text}
    args.\colorbox  = <[ H i? c g ]>
    \colorbox       : (model, color, text) ->

    # \fcolorbox{name1}{name2}{text}
    # \fcolorbox[model]{specification1}{specification2}{text}
    args.\fcolorbox = <[ H i? c c g ]>
    \fcolorbox      : (model, color, text) ->
