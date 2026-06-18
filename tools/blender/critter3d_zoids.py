# Construye un CRITTER en 3D desde su spec (apariencia + colores del juego) y lo renderiza.
# VARIANTE "zoids": hormiga SUPER MECHA estilo ZOIDS insect-mech.
#   - coraza FACETADA en BANDAS apiladas (shells biselados que se solapan) sobre un chasis oscuro
#   - juntas servo expuestas entre segmentos, pistones hidraulicos en cada pata
#   - mangueras/cables entre cabeza-torax-abdomen, ventilas laterales, mandibulas = cuchillas hidraulicas
#   - mono-ojo sensor brillante + ojos secundarios negros, conduits de energia en las costuras
#   - doble escape (boosters) en el abdomen. TODO simetrico y determinista (nada de kitbash random).
# Uso:  blender --background --python critter3d_zoids.py -- <spec.json> <out.png> [samples] [res]
import bpy, bmesh, json, sys, math, random, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
spec_path = argv[0] if len(argv) > 0 else "/tmp/critter_spec.json"
out_path  = argv[1] if len(argv) > 1 else "/tmp/critter3d.png"
opt_samples = int(argv[2]) if len(argv) > 2 else 320     # bajar para iterar rapido
opt_res     = int(argv[3]) if len(argv) > 3 else 1024
spec = json.load(open(spec_path))
A, C = spec["appearance"], spec["colors"]

# GATING por partes (contrato de critter3d_chimera.py): sin CHIMERA_PARTS/CRITTER_PARTS
# se construye TODO (comportamiento standalone identico al original).
_cp = globals().get("CHIMERA_PARTS") or os.environ.get("CRITTER_PARTS")
PARTS = set(_cp.split(",")) if _cp else {"reset", "head", "thorax", "abdomen", "legs", "antennae", "scene"}

def h32(s):  # hash estable (djb2) -> detalle DETERMINISTA por genoma
    h = 5381
    for ch in str(s): h = ((h * 33) ^ ord(ch)) & 0xffffffff
    return h
RNG = random.Random(h32(spec.get("id", "critter")))   # (casi sin uso: el mecha es deliberado)

if "reset" in PARTS:
    bpy.ops.wm.read_factory_settings(use_empty=True)

S = 0.1
def P2(sx, sy): return ((sx - 50) * S, (50 - sy) * S)   # svg cenital -> mundo; cabeza al frente (+Y)
def hx(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4))
def srgb(c): return tuple((v/12.92 if v <= 0.04045 else ((v+0.055)/1.055)**2.4) for v in c)
CHITIN, EDGE, GLOW = srgb(hx(C["cBot"])), srgb(hx(C["edge"])), srgb(hx(C["glow"]))
ARMOR_C = srgb(hx(C["cTop"]))

# ---------- materiales (3 tonos mecha: chasis gunmetal + coraza color elemento + paneles claros) ----------
def _principled(name, color, metallic, rough, coat=0.0):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    for k, v in (("Metallic", metallic), ("Roughness", rough)):
        if k in b.inputs: b.inputs[k].default_value = v
    if coat:
        for k in ("Coat Weight", "Clearcoat", "Coat"):
            if k in b.inputs: b.inputs[k].default_value = coat; break
    return m

def mat_glow(strength=9.0):
    nm = "glow%d" % int(strength)
    m = bpy.data.materials.get(nm)
    if m: return m
    m = bpy.data.materials.new(nm); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = (*GLOW, 1); em.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(em.outputs[0], out.inputs[0])
    return m

frame   = _principled("frame",  (0.055, 0.06, 0.07), 0.80, 0.42)            # chasis gunmetal oscuro
armor   = _principled("armor",  ARMOR_C, 0.30, 0.38, coat=0.40)             # coraza color elemento (cTop)
armor_dk= _principled("armorDk", CHITIN, 0.35, 0.42, coat=0.30)             # coraza oscura (cBot) alterna
panel2  = _principled("panel2", (0.74, 0.75, 0.78), 0.55, 0.28, coat=0.40)  # paneles claros casi blancos
silver  = _principled("silver", (0.82, 0.83, 0.86), 1.00, 0.16)             # vastagos de piston pulidos
hose    = _principled("hose",   (0.055, 0.055, 0.062), 0.00, 0.45)          # manguera de goma
eye_mat = _principled("eye",    (0.01, 0.01, 0.01), 0.00, 0.12)             # ojos negros glossy
glow9, glowB, glow5 = mat_glow(9), mat_glow(16), mat_glow(5)   # glow5: superficies glow GRANDES (no se queman a blanco)

# ---------- helpers de geometria hard-surface (sin booleanos: rapido y limpio) ----------
def shade_smooth(me, ang=35):
    for p in me.polygons: p.use_smooth = True
    if hasattr(me, "use_auto_smooth"):
        me.use_auto_smooth = True; me.auto_smooth_angle = math.radians(ang)

def _mkobj(name, bm, mat, bevel=0.0, smooth=0):
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    if mat: ob.data.materials.append(mat)
    if bevel > 0:
        bv = ob.modifiers.new("bevel", "BEVEL"); bv.width = bevel; bv.segments = 2
    if smooth: shade_smooth(me, smooth)
    return ob

def add_loft(name, rings, mat, nsides=10, bevel=0.03, phase=None):
    # CASCO FACETADO: secciones N-gon en el plano XZ barridas a lo largo de Y (cx=0 -> simetria bilateral).
    # rings: lista de (y, cz, rx, rz). Caras planas + bevel = look hard-surface.
    if phase is None: phase = math.pi/2 - math.pi/nsides   # faceta plana arriba y abajo, simetrica en X
    bm = bmesh.new(); loops = []
    for (y, cz, rx, rz) in rings:
        ring = [bm.verts.new((rx*math.cos(2*math.pi*i/nsides + phase), y, cz + rz*math.sin(2*math.pi*i/nsides + phase)))
                for i in range(nsides)]
        loops.append(ring)
    for a, b in zip(loops, loops[1:]):
        for i in range(nsides):
            bm.faces.new([a[i], a[(i+1) % nsides], b[(i+1) % nsides], b[i]])
    bm.faces.new(loops[0][::-1]); bm.faces.new(loops[-1])
    return _mkobj(name, bm, mat, bevel=bevel)

def add_cyl(name, p0, p1, r, mat, nseg=14, bevel=0.012, cap=True, smooth=35):
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0; L = max(d.length, 1e-5)
    bm = bmesh.new(); r0 = []; r1 = []
    for i in range(nseg):
        a = 2*math.pi*i/nseg; x, y = r*math.cos(a), r*math.sin(a)
        r0.append(bm.verts.new((x, y, -L/2))); r1.append(bm.verts.new((x, y, L/2)))
    for i in range(nseg):
        bm.faces.new([r0[i], r0[(i+1) % nseg], r1[(i+1) % nseg], r1[i]])
    if cap: bm.faces.new(r0[::-1]); bm.faces.new(r1)
    ob = _mkobj(name, bm, mat, bevel=bevel, smooth=smooth)
    ob.location = (p0 + p1) / 2; ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return ob

def add_limb(name, p0, p1, w0, h0, w1, h1, mat, bevel=0.022):
    # MIEMBRO facetado: prisma rectangular AHUSADO de p0 a p1 (femur/tibia/tarso mecanicos).
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0; dn = d.normalized()
    ref = Vector((0, 0, 1)) if abs(dn.z) < 0.95 else Vector((0, 1, 0))
    ax = dn.cross(ref).normalized(); ay = ax.cross(dn).normalized()
    bm = bmesh.new()
    sq = ((1, 1), (1, -1), (-1, -1), (-1, 1))
    c0 = [bm.verts.new((*(p0 + ax*sx*w0 + ay*sy*h0),)) for sx, sy in sq]
    c1 = [bm.verts.new((*(p1 + ax*sx*w1 + ay*sy*h1),)) for sx, sy in sq]
    bm.faces.new(c0[::-1]); bm.faces.new(c1)
    for i in range(4): bm.faces.new([c0[i], c0[(i+1) % 4], c1[(i+1) % 4], c1[i]])
    return _mkobj(name, bm, mat, bevel=bevel)

def add_box(name, loc, size, mat, rot=None, bevel=0.012):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co.x *= size[0]; v.co.y *= size[1]; v.co.z *= size[2]
    ob = _mkobj(name, bm, mat, bevel=bevel)
    ob.location = loc
    if rot is not None: ob.rotation_euler = rot
    return ob

def add_sphere(name, loc, radius, mat):
    bm = bmesh.new()
    try: bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius)
    except TypeError: bmesh.ops.create_icosphere(bm, subdivisions=2, diameter=radius*2)
    ob = _mkobj(name, bm, mat, smooth=60); ob.location = loc
    return ob

def add_diamond(name, loc, size, mat):
    bm = bmesh.new(); s = size
    top = bm.verts.new((0, 0, s)); bot = bm.verts.new((0, 0, -s))
    mid = [bm.verts.new((s, 0, 0)), bm.verts.new((0, s, 0)), bm.verts.new((-s, 0, 0)), bm.verts.new((0, -s, 0))]
    for i in range(4):
        bm.faces.new([top, mid[i], mid[(i+1) % 4]]); bm.faces.new([bot, mid[(i+1) % 4], mid[i]])
    ob = _mkobj(name, bm, mat); ob.location = loc
    return ob

def add_spike(name, base, direction, length, width, mat):
    up = Vector(direction); up.normalize()
    ref = Vector((0, 0, 1)) if abs(up.z) < 0.9 else Vector((1, 0, 0))
    ax = up.cross(ref); ax.normalize(); ay = up.cross(ax); ay.normalize()
    b = Vector(base); w = width
    bm = bmesh.new()
    quad = [b+ax*w+ay*w, b+ax*w-ay*w, b-ax*w-ay*w, b-ax*w+ay*w]
    bv = [bm.verts.new((p.x, p.y, p.z)) for p in quad]
    tip = bm.verts.new((*(b + up*length),))
    bm.faces.new(bv[::-1])
    for i in range(4): bm.faces.new([bv[i], bv[(i+1) % 4], tip])
    return _mkobj(name, bm, mat, bevel=0.008)

def add_tube(name, pts3d, radius, mat):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('NURBS'); sp.points.add(len(pts3d) - 1)
    for i, p in enumerate(pts3d): sp.points[i].co = (p[0], p[1], p[2], 1)
    sp.use_endpoint_u = True; sp.order_u = min(3, len(pts3d))
    cu.bevel_depth = radius; cu.bevel_resolution = 3; cu.fill_mode = 'FULL'
    ob = bpy.data.objects.new(name, cu); bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat); return ob

def add_ring_y(name, y, cz, rx, rz, radius, mat, nseg=42):
    # ANILLO alrededor del eje Y (seccion XZ): conduit de energia en una costura de la coraza.
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('POLY'); sp.points.add(nseg - 1)
    for i in range(nseg):
        a = 2*math.pi*i/nseg
        sp.points[i].co = (rx*math.cos(a), y, cz + rz*math.sin(a), 1)
    sp.use_cyclic_u = True
    cu.bevel_depth = radius; cu.bevel_resolution = 2; cu.fill_mode = 'FULL'
    ob = bpy.data.objects.new(name, cu); bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat); return ob

def add_blade(name, pts2d, z0, z1, mat, bevel=0.012):
    # CUCHILLA plana: poligono (vista cenital) extruido en Z -> mandibula cortadora hidraulica.
    bm = bmesh.new()
    bot = [bm.verts.new((x, y, z0)) for (x, y) in pts2d]
    top = [bm.verts.new((x, y, z1)) for (x, y) in pts2d]
    fb = bm.faces.new(bot[::-1]); ft = bm.faces.new(top)
    n = len(pts2d)
    for i in range(n): bm.faces.new([bot[i], bot[(i+1) % n], top[(i+1) % n], top[i]])
    bmesh.ops.triangulate(bm, faces=[fb, ft])   # el perfil es concavo: triangular las tapas
    return _mkobj(name, bm, mat, bevel=bevel)

def add_servo(name, center, axis, r, length, glow_ring=True):
    # JUNTA SERVO expuesta: tambor + bujes claros en las tapas + anillo de energia en el centro.
    c = Vector(center); a = Vector(axis)
    if a.length < 1e-5: a = Vector((1, 0, 0))
    a.normalize()
    add_cyl(name, c - a*(length/2), c + a*(length/2), r, frame, cap=True)
    add_cyl(name + "_hub", c - a*(length/2 + 0.015), c + a*(length/2 + 0.015), r*0.45, panel2, cap=True)
    if glow_ring:
        add_cyl(name + "_glow", c - a*0.045, c + a*0.045, r*1.06, glowB, cap=False, bevel=0)

def add_piston(name, p0, p1, r=0.026):
    # PISTON hidraulico: vastago pulido + camisa oscura que cubre el primer 55% + rotulas.
    p0, p1 = Vector(p0), Vector(p1)
    add_cyl(name + "_rod", p0, p1, r, silver, cap=True, bevel=0)
    add_cyl(name + "_slv", p0, p0 + (p1 - p0)*0.55, r*2.0, frame, cap=True)
    add_sphere(name + "_a", p0, r*2.3, frame); add_sphere(name + "_b", p1, r*1.7, frame)

# ---------- coraza segmentada: bandas facetadas apiladas sobre un nucleo-chasis oscuro ----------
def spine_eval(ctrl, t):
    # ctrl: [(t_i, y, cz, rx, rz)] -> interpola con ease coseno (perfil suave, facetado por el loft)
    t = max(ctrl[0][0], min(ctrl[-1][0], t))
    for j in range(len(ctrl) - 1):
        t0, t1 = ctrl[j][0], ctrl[j+1][0]
        if t <= t1 or j == len(ctrl) - 2:
            u = (t - t0) / max(1e-9, t1 - t0); u = max(0.0, min(1.0, u))
            w = (1 - math.cos(math.pi*u)) / 2
            return tuple(a + (b - a)*w for a, b in zip(ctrl[j][1:], ctrl[j+1][1:]))

def build_banded(prefix, ctrl, nb, band_mats, t_lo=0.0, t_hi=1.0, gap=0.06, nsides=10,
                 core=True, core_scale=0.84, seam_glow=True, bevel=0.03):
    # nb bandas de armadura con labio delantero y reborde trasero acampanado (shingle);
    # entre bandas queda una RANURA donde asoman el chasis oscuro y un conduit de energia GLOW.
    if core:
        rings = []
        for k in range(11):
            y, cz, rx, rz = spine_eval(ctrl, k/10)
            rings.append((y, cz, rx*core_scale, rz*core_scale))
        add_loft(prefix + "_core", rings, frame, nsides=nsides, bevel=0.015)
    span = t_hi - t_lo
    for i in range(nb):
        b0 = t_lo + span*i/nb + (span*gap*0.5 if i > 0 else 0)
        b1 = t_lo + span*(i+1)/nb - (span*gap*0.5 if i < nb-1 else 0)
        rings = []
        for f, s in zip((0.0, 0.25, 0.7, 1.0), (1.05, 1.0, 1.01, 1.08)):   # labio + flare trasero
            y, cz, rx, rz = spine_eval(ctrl, b0 + (b1 - b0)*f)
            rings.append((y, cz, rx*s, rz*s))
        add_loft("%s_band%d" % (prefix, i), rings, band_mats[i % len(band_mats)], nsides=nsides, bevel=bevel)
        if seam_glow and i < nb - 1:
            tg = t_lo + span*(i+1)/nb
            y, cz, rx, rz = spine_eval(ctrl, tg)
            add_ring_y("%s_seam%d" % (prefix, i), y, cz, rx*1.0, rz*1.0, 0.042, glowB)

# ---------- construir el critter ----------
xC, y0, y1, y2 = 50, 24, 50, 76
hasTh = A.get("thorax", -1) >= 0
hasAb = A.get("abdomen", -1) >= 0
# filas de anclaje de PATAS adaptativas: solo se ancla sobre masas que EXISTEN
# (sin torax/abdomen las patas no flotan: se abren en abanico alrededor de la cabeza)
_rows = [y0] + ([y1] if hasTh else []) + ([y2] if hasAb else [])
if len(_rows) == 3:   rowY = [y0, y1, y2]
elif len(_rows) == 2: rowY = [_rows[0], (_rows[0] + _rows[1]) // 2, _rows[1]]
else:                 rowY = [y0 - 8, y0, y0 + 8]
_legmask = int(A.get("legs", 0)) & 63
legs_n = bin(_legmask).count("1")
seg_z0 = 0.42 if legs_n > 0 else 0.14
zb = seg_z0 + 0.50
hcx, hcy = P2(xC, y0); tcx, tcy = P2(xC, y1); acx, acy = P2(xC, y2)
head_cz = zb + 0.05

# ctrl curves del esqueleto: SIEMPRE a nivel de modulo (fuera de los gates de parte),
# asi cualquier parte gateada que las necesite (visor/ojos/mandibulas/bandas) las encuentra.
hsc = 1.25 if A.get("head") == 3 else 1.0
front_rx, front_rz, front_y = (0.34, 0.22, 1.45) if A.get("head") == 1 else (0.50, 0.30, 1.30)
ctrl_head = [
    (0.00, hcy - 1.00, head_cz + 0.02, 0.78*hsc, 0.50),
    (0.35, hcy - 0.30, head_cz + 0.08, 1.10*hsc, 0.64),
    (0.70, hcy + 0.55, head_cz + 0.02, 0.92*hsc, 0.54),
    (1.00, hcy + front_y, head_cz - 0.10, front_rx*hsc, front_rz)]
ctrl_th = [
    (0.00, tcy + 1.05, zb + 0.02, 0.88, 0.56),
    (0.45, tcy + 0.10, zb + 0.10, 1.12, 0.68),
    (1.00, tcy - 1.05, zb + 0.00, 0.86, 0.52)]
drop = 0.45 if A.get("abdomen") == 1 else 0.30
ctrl_ab = [
    (0.00, acy + 1.35, zb + 0.05, 0.95, 0.60),
    (0.30, acy + 0.45, zb + 0.08, 1.42, 0.82),
    (0.62, acy - 0.55, zb - 0.02, 1.25, 0.74),
    (1.00, acy - 1.95, zb - drop, 0.44, 0.30)]

# === CABEZA: craneo facetado con 2 bandas de coraza + carcasa de hocico oscura ===
if "head" in PARTS:
    build_banded("head", ctrl_head, 2, [armor, armor], t_lo=0.02, t_hi=0.60, nsides=8)
    build_banded("face", ctrl_head, 1, [armor_dk], t_lo=0.68, t_hi=0.99, nsides=8, core=False, seam_glow=False)

    # VISOR glow en la ceja (arco SOBRE la carcasa de la cara) + MONO-OJO de nariz
    yB, czB, rxB, rzB = spine_eval(ctrl_head, 0.80)
    brow = [(1.07*rxB*math.cos(math.radians(a)), yB, czB + 1.07*rzB*math.sin(math.radians(a))) for a in range(140, 39, -10)]
    add_tube("visor_glow", brow, 0.036, glowB)
    nose_y = hcy + front_y - 0.10
    add_cyl("nose_sock", (0, nose_y - 0.06, head_cz - 0.08), (0, nose_y + 0.24, head_cz - 0.08), 0.165, frame, cap=False)
    add_sphere("monoeye", (0, nose_y + 0.16, head_cz - 0.08), 0.125, glowB)
    # ojos secundarios NEGROS montados sobre la carcasa de la cara (medio embebidos)
    yE, czE, rxE, rzE = spine_eval(ctrl_head, 0.72)
    for s in (-1, 1):
        add_sphere("eye%+d" % s, (s*1.05*rxE*math.cos(math.radians(42)), yE, czE + 1.05*rzE*math.sin(math.radians(42))), 0.125, eye_mat)

    # MANDIBULAS (head 2): CUCHILLAS cortadoras hidraulicas largas + piston + filo de energia
    if A.get("head") == 2:
        for s in (-1, 1):
            pts = [P2(xC + s*7, y0 - 7), P2(xC + s*11, y0 - 13), P2(xC + s*10, y0 - 21),
                   P2(xC + s*3.5, y0 - 28), P2(xC + s*5.5, y0 - 19), P2(xC + s*4.5, y0 - 10)]
            add_blade("mand%+d" % s, pts, head_cz - 0.28, head_cz - 0.02, armor)
            hp = P2(xC + s*7, y0 - 7)
            add_cyl("mandhinge%+d" % s, (hp[0], hp[1], head_cz - 0.36), (hp[0], hp[1], head_cz + 0.08), 0.10, frame)
            tgt = P2(xC + s*9.5, y0 - 15)
            add_piston("mandpis%+d" % s, (s*0.55, hcy + 0.50, head_cz + 0.16), (tgt[0], tgt[1], head_cz - 0.02), r=0.026)
            e0 = P2(xC + s*5.5, y0 - 19); e1 = P2(xC + s*3.5, y0 - 28)
            add_tube("mandedge%+d" % s, [(e0[0], e0[1], head_cz - 0.15), (e1[0], e1[1], head_cz - 0.15)], 0.024, glow9)

# === TORAX: 3 bandas + reactor glow dorsal + ventilas laterales + conduits dorsales ===
if "thorax" in PARTS and hasTh:
    build_banded("thorax", ctrl_th, 3, [armor, armor_dk, armor], nsides=10)
    # REACTOR: nucleo de energia dorsal dentro de un aro-chasis (domo que sobresale del lomo)
    add_cyl("reactor_ring", (0, tcy + 0.1, zb + 0.62), (0, tcy + 0.1, zb + 0.90), 0.30, frame, cap=False)
    add_sphere("reactor", (0, tcy + 0.1, zb + 0.92), 0.235, glow5)
    # VENTILAS de admision en los flancos (carcasa + 3 aletas claras + ranura glow)
    for s in (-1, 1):
        add_box("vent%+d" % s, (s*1.18, tcy + 0.05, zb + 0.20), (0.09, 0.40, 0.28), frame,
                rot=(0, math.radians(s*8), 0), bevel=0.015)
        add_box("ventg%+d" % s, (s*1.24, tcy + 0.05, zb + 0.20), (0.02, 0.34, 0.21), glow9,
                rot=(0, math.radians(s*8), 0), bevel=0)
        for k, dz in enumerate((-0.15, 0.0, 0.15)):
            add_box("ventfin%+d_%d" % (s, k), (s*1.31, tcy + 0.05, zb + 0.20 + dz), (0.06, 0.34, 0.024),
                    panel2, rot=(math.radians(26), math.radians(s*8), 0), bevel=0.006)
    # conduits de energia dorsales (corren por la costura del lomo, espejados)
    for s in (-1, 1):
        add_tube("conduit%+d" % s, [(s*0.34, tcy + 0.92, zb + 0.56), (s*0.42, tcy, zb + 0.70),
                                    (s*0.34, tcy - 0.92, zb + 0.52)], 0.02, glow9)

# === ABDOMEN / gaster: 4 bandas telescopicas (lagrima que cae) + doble ESCAPE booster ===
if "abdomen" in PARTS and hasAb:
    build_banded("abdomen", ctrl_ab, 4, [armor, armor_dk], nsides=10)
    for s in (-1, 1):   # ESCAPES gemelos: chimeneas verticales chatas sobre el lomo delantero del gaster
        p0 = Vector((s*0.55, acy + 0.55, zb + 0.60)); p1 = Vector((s*0.74, acy + 0.18, zb + 1.48))
        dn = (p1 - p0).normalized()
        add_cyl("exh%+d" % s, p0, p1, 0.145, frame, cap=True)
        add_cyl("exhn%+d" % s, p1 - dn*0.16, p1 + dn*0.04, 0.175, panel2, cap=False)
        add_cyl("exhg%+d" % s, p1 - dn*0.005, p1 + dn*0.030, 0.100, glowB, cap=True, bevel=0)
        add_cyl("exhrng%+d" % s, p0 + (p1-p0)*0.52 - dn*0.035, p0 + (p1-p0)*0.52 + dn*0.035, 0.160,
                armor_dk, cap=False)   # zuncho que abraza la chimenea
    # AGUIJON-TOBERA en la punta del gaster (cono claro + nucleo glow)
    tail = Vector((0, acy - 1.90, zb - drop + 0.02)); tdir = Vector((0, -1, -0.30)).normalized()
    add_cyl("sting_base", tail - tdir*0.10, tail + tdir*0.16, 0.16, frame, cap=True)
    add_spike("stinger", tail + tdir*0.12, tdir, 0.50, 0.115, panel2)
    add_diamond("stingtip", tail + tdir*0.62, 0.055, glowB)

# === CUELLO y CINTURA: servos expuestos (eje X) + espina inferior + MANGUERAS ===
# (CONECTORES entre masas: pertenecen a la parte "thorax", que es duena de los puentes)
if "thorax" in PARTS and hasTh:
    y_n = (hcy - 1.00 + tcy + 1.05) / 2
    add_servo("neck", (0, y_n, zb + 0.10), (1, 0, 0), 0.24, 0.66)
    add_tube("neckspine", [(0, hcy - 0.80, zb - 0.12), (0, y_n, zb - 0.20), (0, tcy + 0.85, zb - 0.14)], 0.10, frame)
    for s in (-1, 1):   # cables DORSALES en arco sobre el cuello (puentean por ENCIMA del gap) + manguera baja
        add_tube("hoseN1%+d" % s, [(s*0.26, hcy - 0.50, zb + 0.58), (s*0.42, y_n, zb + 0.84),
                                   (s*0.28, tcy + 0.55, zb + 0.62)], 0.042, hose)
        add_tube("hoseN2%+d" % s, [(s*0.52, hcy - 0.65, zb + 0.06), (s*1.02, y_n, zb - 0.30),
                                   (s*0.54, tcy + 0.78, zb + 0.02)], 0.040, hose)
if "thorax" in PARTS and (not hasTh) and hasAb:
    # SIN TORAX pero CON abdomen: puente DIRECTO cabeza->abdomen (si no, flotan separados).
    y_m = (hcy + acy) / 2
    add_servo("midbridge", (0, y_m, zb + 0.08), (1, 0, 0), 0.28, 0.78)
    add_tube("midspine", [(0, hcy - 0.80, zb - 0.10), (0, y_m, zb - 0.22), (0, acy + 1.05, zb - 0.14)], 0.14, frame)
    for s in (-1, 1):
        add_tube("hoseM1%+d" % s, [(s*0.27, hcy - 0.55, zb + 0.58), (s*0.46, y_m, zb + 0.86), (s*0.29, acy + 0.95, zb + 0.62)], 0.044, hose)
        add_tube("hoseM2%+d" % s, [(s*0.55, hcy - 0.70, zb + 0.04), (s*1.08, y_m, zb - 0.32), (s*0.57, acy + 1.05, zb + 0.00)], 0.040, hose)
if "thorax" in PARTS and hasTh and hasAb:
    y_w = (tcy - 1.05 + acy + 1.35) / 2
    add_servo("waist", (0, y_w, zb + 0.06), (1, 0, 0), 0.27, 0.76)
    add_tube("waistspine", [(0, tcy - 0.85, zb - 0.14), (0, y_w, zb - 0.24), (0, acy + 1.1, zb - 0.16)], 0.11, frame)
    for s in (-1, 1):   # cables DORSALES en arco sobre la cintura (por ENCIMA del gap) + manguera baja
        add_tube("hoseW1%+d" % s, [(s*0.28, tcy - 0.58, zb + 0.52), (s*0.46, y_w, zb + 0.88),
                                   (s*0.30, acy + 0.90, zb + 0.62)], 0.044, hose)
        add_tube("hoseW2%+d" % s, [(s*0.56, tcy - 0.75, zb + 0.00), (s*1.10, y_w, zb - 0.36),
                                   (s*0.58, acy + 1.05, zb - 0.04)], 0.040, hose)

# === PATAS: servo cadera + femur facetado + servo rodilla glow + tibia + PISTONES + garra ===
LEG_CELLS = [(0, -1), (0, 1), (1, -1), (1, 1), (2, -1), (2, 1)]
ROW_POSE = {  # postura AGRESIVA: delanteras estiradas al frente, traseras hacia atras (svg dy)
    0: {"knee": -4, "ank": -7, "foot": -10, "spread": 33},
    1: {"knee":  0, "ank":  1, "foot":  2, "spread": 35},
    2: {"knee":  5, "ank":  8, "foot": 11, "spread": 34}}
knee_up = 0.92 if A.get("legStyle") == 1 else 0.62
import os as _osL, sys as _sysL
_sysL.path.append(_osL.path.dirname(_osL.path.abspath(__file__)))
import critter3d_legs as _legmod
_SEL = _legmod.cells_from_mask(_legmask)   # celdas desde la MASCARA (posicion genetica)
if "legs" in PARTS:
    for i in range(legs_n):
        _lb = set(bpy.data.objects)   # taggear esta pata con su INDICE (para animarla en cams)
        r, side = _SEL[i]; yy = rowY[r]; pose = ROW_POSE[r]
        hip   = Vector((*P2(xC + side*9.5, yy), zb - 0.12))
        knee  = Vector((*P2(xC + side*20, yy + pose["knee"]), seg_z0 + knee_up))
        ankle = Vector((*P2(xC + side*29, yy + pose["ank"]),  seg_z0 + 0.10))
        foot  = Vector((*P2(xC + side*pose["spread"], yy + pose["foot"]), 0.02))
        fdir = (knee - hip).normalized()
        axF = fdir.cross(Vector((0, 0, 1)))
        if axF.length < 1e-4: axF = Vector((0, 1, 0))
        axF.normalize()
        add_servo("hip%d" % i, hip, axF, 0.185, 0.30, glow_ring=False)
        add_limb("femur%d" % i, hip, knee, 0.150, 0.185, 0.110, 0.135, armor)        # femur acorazado
        add_servo("knee%d" % i, knee, axF, 0.155, 0.30)                              # rodilla con aro glow
        add_limb("tibia%d" % i, knee, ankle, 0.105, 0.120, 0.060, 0.070, frame)      # tibia chasis
        add_piston("pisF%d" % i, hip + Vector((0, 0, 0.26)), hip + (knee - hip)*0.80 + Vector((0, 0, 0.10)), r=0.034)
        add_piston("pisT%d" % i, knee + (ankle - knee)*0.12 + Vector((0, 0, 0.16)),
                   knee + (ankle - knee)*0.64 + Vector((0, 0, 0.04)), r=0.026)
        add_sphere("ankle%d" % i, ankle, 0.085, frame)
        add_limb("tars%d" % i, ankle, foot, 0.050, 0.055, 0.032, 0.036, frame)
        cd = Vector((foot.x - ankle.x, foot.y - ankle.y, 0)).normalized()
        add_spike("claw%d" % i, foot, (cd.x, cd.y, -0.75), 0.20, 0.055, panel2)      # garra principal
        add_spike("dew%d" % i, foot + Vector((0, 0, 0.05)), (-cd.x*0.5, -cd.y*0.5, -0.95), 0.13, 0.042, panel2)
        add_diamond("ftip%d" % i, (foot.x, foot.y, 0.04), 0.055, glow9)
        for _o in (set(bpy.data.objects) - _lb): _o["leg"] = i + 1   # idx 1-based (0 es falsy)

# === ANTENAS: mastiles sensores articulados (servo base + codo + punta glow) ===
if "antennae" in PARTS and A.get("antennae"):
    for s in (-1, 1):
        base  = Vector((s*0.34, hcy - 0.35, head_cz + 0.55))
        elbow = Vector((s*0.58, hcy + 0.15, head_cz + 1.05))
        tip   = Vector((s*0.88, hcy + 0.85, head_cz + 1.45))
        add_sphere("antbase%+d" % s, (s*0.32, hcy - 0.32, head_cz + 0.62), 0.085, frame)
        add_cyl("antA%+d" % s, base, elbow, 0.037, frame, cap=True)
        add_sphere("antelb%+d" % s, elbow, 0.058, panel2)
        add_cyl("antB%+d" % s, elbow, tip, 0.026, frame, cap=True)
        add_diamond("anttip%+d" % s, tip, 0.062, glowB)

# ---------- escena ----------
def add_area(name, loc, energy, size, color=(1, 1, 1), rot=None):
    l = bpy.data.lights.new(name, 'AREA'); l.energy = energy; l.size = size; l.color = color
    o = bpy.data.objects.new(name, l); o.location = loc; bpy.context.collection.objects.link(o)
    if rot is not None: o.rotation_euler = rot
    else: o.rotation_euler = (Vector((0, 0, 0.4)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()

if "scene" in PARTS:
    add_area("key", (3.5, 4.5, 5.5), 700, 4)        # frente (+Y, lado de la cara)
    add_area("fill", (-4.5, 3, 3), 240, 5)
    add_area("top", (0.5, 0.5, 7.0), 380, 6)        # cenital (saca brillo en los paneles de arriba)
    add_area("rim", (-2.5, -5.5, 3.5), 700, 4, (1.0, 0.55, 0.35))   # atras (-Y), rim calido
    add_area("rim2", (4.2555, 7.1332, -2.0159), 600, 4, (1.0, 0.55, 0.35),
             rot=(math.radians(-35.37), math.radians(4.91), math.radians(-8.21)))

    # MUNDO: la camara ve NEGRO (aislado), pero los reflejos/AO ven un entorno gris -> el metal "lee"
    w = bpy.data.worlds.new("w"); bpy.context.scene.world = w; w.use_nodes = True
    nt = w.node_tree; nt.nodes.clear()
    o_w = nt.nodes.new("ShaderNodeOutputWorld"); mix = nt.nodes.new("ShaderNodeMixShader")
    lp = nt.nodes.new("ShaderNodeLightPath")
    bg_k = nt.nodes.new("ShaderNodeBackground"); bg_k.inputs[0].default_value = (0, 0, 0, 1)
    bg_e = nt.nodes.new("ShaderNodeBackground"); bg_e.inputs[0].default_value = (0.22, 0.23, 0.27, 1); bg_e.inputs[1].default_value = 0.7
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(bg_e.outputs[0], mix.inputs[1])   # rayos no-camara (reflejo/difuso) -> entorno gris
    nt.links.new(bg_k.outputs[0], mix.inputs[2])   # rayos de camara -> negro
    nt.links.new(mix.outputs[0], o_w.inputs[0])

    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = opt_samples
    try: sc.cycles.use_denoising = bool(os.environ.get("CRITTER_DENOISE"))   # local sin OIDN: apagado; la Lambda lo enciende
    except Exception: pass
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for ctype in ('OPTIX', 'CUDA'):
            try:
                prefs.compute_device_type = ctype; prefs.get_devices()
                for dev in prefs.devices: dev.use = True
                sc.cycles.device = 'GPU'; break
            except Exception: pass
    except Exception: pass
    sc.render.resolution_x = opt_res; sc.render.resolution_y = opt_res
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = out_path
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    import critter3d_cams
    critter3d_cams.render_views(out_path, spec.get("name"), lens=60.0)
