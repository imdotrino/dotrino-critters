# Port a Python de la derivacion genoma-id -> spec 3D (apariencia + colores), calcado de
# tools/blender/critter_spec.mjs + src/critter/forge.js (parseGenome) + src/critter/types.js
# (elementInfo). La Lambda lo usa para NO depender de Node: el render solo necesita
# appearance + colors (el nombre/rareza del juego no afectan al modelo).
# DEBE producir exactamente los mismos numeros que el pipeline JS (ver test_spec_derive.sh).
import math, re

ELEMENT_INFO = {
    "fuego":  ("#f97316", "#7c2d12"),
    "agua":   ("#38bdf8", "#075985"),
    "planta": ("#22c55e", "#14532d"),
    "rayo":   ("#facc15", "#854d0e"),
    "hielo":  ("#67e8f9", "#0e7490"),
    "sombra": ("#a78bfa", "#4c1d95"),
}

def _js_round(x):
    # Math.round de JS: mitades SIEMPRE hacia arriba (Python round() es bancario)
    return math.floor(x + 0.5)

def _hx(h):
    h = str(h).replace("#", "")
    out = []
    for i in (0, 2, 4):
        try: out.append(int(h[i:i+2], 16))
        except Exception: out.append(0)
    return out

def _clamp(v): return max(0, min(255, _js_round(v)))

def _rgb_hex(r, g, b):
    return "#" + "".join("%02x" % _clamp(v) for v in (r, g, b))

def element_colors(el):
    # types.js elementInfo: promedia color/color2 de TODAS las bases (con multiplicidad). El
    # elemento puede traer ingredientes con nivel ("fuego.fuego" = un sub) → se aplana por "+" y ".".
    comps = [c for c in re.split(r"[+.]", str(el)) if c in ELEMENT_INFO]
    if not comps: comps = ["fuego"]
    n = len(comps)
    c1 = [_hx(ELEMENT_INFO[c][0]) for c in comps]
    c2 = [_hx(ELEMENT_INFO[c][1]) for c in comps]
    color = _rgb_hex(*(sum(v[i] for v in c1) / n for i in range(3)))
    color2 = _rgb_hex(*(sum(v[i] for v in c2) / n for i in range(3)))
    return color, color2

def _shift(hexs, deg):
    # critter_spec.mjs shift: corre r hacia arriba y b hacia abajo (g intacto), clamp 0..255
    r, g, b = _hx(hexs)
    f = 1 + deg / 255
    r = _clamp(r * f); b = _clamp(b * (2 - f))
    return "#%02x%02x%02x" % (r, g, b)

def _darken(hexs, f):
    r, g, b = _hx(hexs)
    return "#%02x%02x%02x" % (_js_round(r * f), _js_round(g * f), _js_round(b * f))

def _jsnum(parts, i, dflt=0):
    # JS "+p[i] || dflt": indice ausente o no-numerico -> dflt; "-0"/"0" -> 0
    if i >= len(parts): return dflt
    try: return int(float(parts[i]))
    except Exception: return dflt

def spec_from_id(gid):
    """'g:seed:element:role:head:thorax:abdomen:legs:legStyle:ant:hue:pattern' -> spec dict."""
    p = str(gid).split(":")
    if not p or p[0] != "g":
        raise ValueError("genome id invalido (debe empezar con 'g:'): %r" % gid)
    element = p[2] if len(p) > 2 else "fuego"
    appearance = {
        "head":     _jsnum(p, 4),
        "thorax":   _jsnum(p, 5, -1) if len(p) > 5 else -1,
        "abdomen":  _jsnum(p, 6, -1) if len(p) > 6 else -1,
        "legs":     _jsnum(p, 7),
        "legStyle": _jsnum(p, 8),
        "antennae": len(p) > 9 and p[9] == "1",
        "hue":      _jsnum(p, 10),
        "pattern":  _jsnum(p, 11),
    }
    color, color2 = element_colors(element)
    glow = _shift(color, appearance["hue"] or 0)
    colors = {
        "glow": glow,
        "cTop": _darken(glow, 0.55),
        "cBot": _darken(color2 or color, 0.85),
        "edge": _darken(color2 or color, 0.5),
    }
    return {"id": str(gid), "name": p[1] if len(p) > 1 else "critter",
            "element": element, "appearance": appearance, "colors": colors}
