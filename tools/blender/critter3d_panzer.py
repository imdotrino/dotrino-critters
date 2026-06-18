# Construye un CRITTER en 3D desde su spec (apariencia + colores del juego) y lo renderiza.
# VARIANTE "panzer": SUPER MECHA pesada — hormiga como plataforma de armas blindada.
#   Placas masivas biseladas, remaches en filas simétricas, hombreras sobre las patas,
#   faldones de blindaje, núcleo de energía hundido en el tórax con aletas radiadoras,
#   abdomen = pod reactor con ranuras de enfriamiento luminosas, mástiles sensores,
#   patas hidráulicas con pistones y pies stomper, y luz de neón bajo las placas.
# SIN kitbash aleatorio: todo el detalle es DELIBERADO y con simetría bilateral.
# Uso:  blender --background --python critter3d_panzer.py -- <spec.json> <out.png> [samples] [res]
import bpy, bmesh, json, sys, math, random, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
spec_path = argv[0] if len(argv) > 0 else "/tmp/critter_spec.json"
out_path  = argv[1] if len(argv) > 1 else "/tmp/critter3d.png"
opt_samples = int(argv[2]) if len(argv) > 2 else 320     # bajar para iterar rapido
opt_res     = int(argv[3]) if len(argv) > 3 else 1024
spec = json.load(open(spec_path))
A, C = spec["appearance"], spec["colors"]

# GATING por partes (contrato quimera): sin CHIMERA_PARTS/CRITTER_PARTS construye TODO.
_cp = globals().get("CHIMERA_PARTS") or os.environ.get("CRITTER_PARTS")
PARTS = set(_cp.split(",")) if _cp else {"reset", "head", "thorax", "abdomen", "legs", "antennae", "scene"}

SEGS = {}   # segmentos del cuerpo por nombre (superficie paramétrica para placas/strips)
def h32(s):  # hash estable (djb2) → detalle DETERMINISTA por genoma
    h = 5381
    for ch in str(s): h = ((h * 33) ^ ord(ch)) & 0xffffffff
    return h
RNG = random.Random(h32(spec.get("id", "critter")))

if "reset" in PARTS:
    bpy.ops.wm.read_factory_settings(use_empty=True)

S = 0.1
def P2(sx, sy): return ((sx - 50) * S, (50 - sy) * S)   # svg cenital -> mundo; cabeza al frente (+Y)
def hx(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4))
def srgb(c): return tuple((v/12.92 if v <= 0.04045 else ((v+0.055)/1.055)**2.4) for v in c)
CHITIN, EDGE, GLOW = srgb(hx(C["cBot"])), srgb(hx(C["edge"])), srgb(hx(C["glow"]))
CTOP = srgb(hx(C["cTop"]))

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

# === paleta panzer (derivada del spec): chasis gunmetal + blindaje del elemento + panel claro ===
def mat_frame():   # CHASIS interno: gunmetal oscuro con un tinte del 'edge' del spec
    c = tuple(0.085 + e*0.30 for e in EDGE)
    return _principled("frame", c, 0.75, 0.45)
def mat_armor():   # BLINDAJE principal: color del elemento (cTop) como pintura metálica
    c = tuple(min(1.0, v*1.45 + 0.012) for v in CTOP)
    return _principled("armor", c, 0.55, 0.38, coat=0.30)
def mat_armor_dk():  # blindaje secundario más oscuro (cBot)
    c = tuple(min(1.0, v*1.05 + 0.006) for v in CHITIN)
    return _principled("armor_dk", c, 0.55, 0.44, coat=0.2)
def mat_panel2():  # PANEL claro casi blanco (multitono mecha)
    return _principled("panel2", (0.70, 0.71, 0.74), 0.45, 0.30, coat=0.4)

def shade_smooth(me, ang=35):
    for p in me.polygons: p.use_smooth = True
    if hasattr(me, "use_auto_smooth"):
        me.use_auto_smooth = True; me.auto_smooth_angle = math.radians(ang)

# ---------- primitivas ----------
def add_tube(name, pts3d, radius, mat, caps=False, res=3):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('POLY'); sp.points.add(len(pts3d) - 1)
    for i, (x, y, z) in enumerate(pts3d): sp.points[i].co = (x, y, z, 1)
    cu.bevel_depth = radius; cu.bevel_resolution = res; cu.fill_mode = 'FULL'
    cu.use_fill_caps = caps
    ob = bpy.data.objects.new(name, cu); bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat); return ob

def add_sphere(name, loc, radius, mat):
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    try: bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius)
    except TypeError: bmesh.ops.create_icosphere(bm, subdivisions=2, diameter=radius * 2)
    bm.to_mesh(me); bm.free()
    ob.location = loc; ob.data.materials.append(mat); shade_smooth(me); return ob

def add_box(name, loc, size, mat, rot=None, bevel=0.018):
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co.x *= size[0]; v.co.y *= size[1]; v.co.z *= size[2]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(me); bm.free()
    ob.location = loc
    if rot is not None: ob.rotation_euler = rot
    ob.data.materials.append(mat)
    if bevel > 0:
        bv = ob.modifiers.new("bevel", "BEVEL"); bv.width = bevel; bv.segments = 2
    shade_smooth(me, 30)
    return ob

def make_torus_obj(name, cx, cy, z, rx, ry, r, smaj=40, smin=10):
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    bm = bmesh.new(); rings = []
    for i in range(smaj):
        a = 2*math.pi*i/smaj
        ctr = Vector((rx*math.cos(a), ry*math.sin(a), 0))
        nrm = Vector((math.cos(a)/max(rx, 1e-4), math.sin(a)/max(ry, 1e-4), 0)); nrm.normalize()
        ring = []
        for j in range(smin):
            b = 2*math.pi*j/smin
            p = ctr + nrm*(r*math.cos(b)) + Vector((0, 0, r*math.sin(b)))
            ring.append(bm.verts.new((cx + p.x, cy + p.y, z + p.z)))
        rings.append(ring)
    for i in range(smaj):
        r1 = rings[i]; r2 = rings[(i+1) % smaj]
        for j in range(smin):
            bm.faces.new([r1[j], r2[j], r2[(j+1) % smin], r1[(j+1) % smin]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(me); bm.free()
    return ob

def add_torus(name, cx, cy, z, rx, ry, r, mat):
    ob = make_torus_obj(name, cx, cy, z, rx, ry, r)
    ob.data.materials.append(mat); shade_smooth(ob.data); return ob

def add_spike(name, base, direction, length, width, mat):
    up = Vector(direction); up.normalize()
    ref = Vector((0, 0, 1)) if abs(up.z) < 0.9 else Vector((1, 0, 0))
    ax = up.cross(ref); ax.normalize(); ay = up.cross(ax); ay.normalize()
    b = Vector(base); w = width
    bm = bmesh.new()
    quad = [b+ax*w+ay*w, b+ax*w-ay*w, b-ax*w-ay*w, b-ax*w+ay*w]
    bv = [bm.verts.new((p.x, p.y, p.z)) for p in quad]
    tip = bm.verts.new((*(b+up*length),))
    bm.faces.new(bv[::-1])
    for i in range(4): bm.faces.new([bv[i], bv[(i+1) % 4], tip])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    bm.to_mesh(me); bm.free(); ob.data.materials.append(mat)
    bvm = ob.modifiers.new("bevel", "BEVEL"); bvm.width = 0.01; bvm.segments = 2
    shade_smooth(me, 30); return ob

def add_organic(name, cx, cy, zmid, rx, ry, hz, mat, taper_y=0.0, drop=0.0, flat=0.18, sub=3):
    # CUERPO base (chasis oscuro): elipsoide suave; taper_y!=0 = lágrima hacia +Y/-Y.
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    try: bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    except TypeError: bmesh.ops.create_icosphere(bm, subdivisions=sub, diameter=2.0)
    sgn = 1.0 if taper_y >= 0 else -1.0
    for v in bm.verts:
        x, y, z = v.co
        wx, wy, wz = x*rx, y*ry, z*hz
        if taper_y != 0:
            f = max(0.0, y*sgn); k = f**1.4
            wx *= (1 - 0.82*k); wy *= (1 + 0.20*f); wz = wz*(1 - 0.4*k) - drop*k
        if z < 0: wz *= (1 - flat*(-z))
        v.co = (cx+wx, cy+wy, zmid+wz)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(me); bm.free()
    ob.data.materials.append(mat); shade_smooth(me, 45)
    SEGS.setdefault(name, {}).update(
        {"name": name, "ob": ob, "cx": cx, "cy": cy, "zmid": zmid,
         "rx": rx, "ry": ry, "hz": hz, "tapy": taper_y, "drop": drop, "flat": flat})
    return ob

# ---------- superficie paramétrica EXACTA del segmento (misma deformación que add_organic) ----------
def spos(seg, th, t):
    t = max(-0.985, min(0.985, t))
    c = math.sqrt(max(0.0, 1.0 - t*t))
    x, y, z = math.cos(th)*c, math.sin(th)*c, t
    wx, wy, wz = x*seg["rx"], y*seg["ry"], z*seg["hz"]
    ty = seg.get("tapy", 0.0)
    if ty != 0:
        sgn = 1.0 if ty >= 0 else -1.0
        f = max(0.0, y*sgn); k = f**1.4
        wx *= (1 - 0.82*k); wy *= (1 + 0.20*f); wz = wz*(1 - 0.4*k) - seg.get("drop", 0.0)*k
    if z < 0: wz *= (1 - seg.get("flat", 0.18)*(-z))
    return Vector((seg["cx"]+wx, seg["cy"]+wy, seg["zmid"]+wz))

def snrm(seg, th, t):
    e = 0.012
    p = spos(seg, th, t)
    du = spos(seg, th+e, t) - p
    dv = spos(seg, th, t+e) - p
    n = du.cross(dv)
    if n.length < 1e-9: n = Vector((math.cos(th), math.sin(th), 0.0))
    n.normalize(); return n

def add_hull_plate(name, seg, th0, th1, t0, t1, lift, thick, mat, nu=16, nv=5, bevel=0.016, flare=0.0):
    # PLACA DE BLINDAJE curva que abraza la superficie exacta del segmento (sin booleanos).
    bm = bmesh.new()
    O = [[None]*(nv+1) for _ in range(nu+1)]; I = [[None]*(nv+1) for _ in range(nu+1)]
    for iu in range(nu+1):
        th = th0 + (th1-th0)*iu/nu
        for iv in range(nv+1):
            fv = iv/nv; t = t0 + (t1-t0)*fv
            p = spos(seg, th, t); n = snrm(seg, th, t)
            lf = lift + flare*(1-fv)                  # labio saliente en el borde inferior
            o = p + n*lf; q = p + n*(lf - thick)
            O[iu][iv] = bm.verts.new(o); I[iu][iv] = bm.verts.new(q)
    def F(a, b, c, d): bm.faces.new([a, b, c, d])
    for iu in range(nu):
        for iv in range(nv):
            F(O[iu][iv], O[iu+1][iv], O[iu+1][iv+1], O[iu][iv+1])
            F(I[iu][iv], I[iu][iv+1], I[iu+1][iv+1], I[iu+1][iv])
    for iu in range(nu):
        F(O[iu][0], I[iu][0], I[iu+1][0], O[iu+1][0]); F(O[iu][nv], O[iu+1][nv], I[iu+1][nv], I[iu][nv])
    for iv in range(nv):
        F(O[0][iv], O[0][iv+1], I[0][iv+1], I[0][iv]); F(O[nu][iv], I[nu][iv], I[nu][iv+1], O[nu][iv+1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    bm.to_mesh(me); bm.free(); ob.data.materials.append(mat)
    if bevel > 0:
        bv = ob.modifiers.new("bevel", "BEVEL"); bv.width = bevel; bv.segments = 2
    shade_smooth(me, 32); return ob

def add_strip(name, seg, th0, th1, t, lift, r, mat, n=18):
    # TIRA DE LUZ que sigue la superficie (luces de panel / ranuras de enfriamiento)
    pts = []
    for i in range(n+1):
        th = th0 + (th1-th0)*i/n
        p = spos(seg, th, t) + snrm(seg, th, t)*lift
        pts.append((p.x, p.y, p.z))
    return add_tube(name, pts, r, mat)

def add_rivets(name, seg, th0, th1, t, lift, n, r=0.034, mat=None):
    # FILA DE REMACHES simétrica (espaciado uniforme, nada aleatorio)
    for i in range(n):
        th = th0 + (th1-th0)*(i+0.5)/n
        p = spos(seg, th, t) + snrm(seg, th, t)*lift
        add_sphere("%s_%d" % (name, i), (p.x, p.y, p.z), r, mat or panel2)

def add_piston(name, p0, p1, r_outer, r_rod, mat_o, mat_r, frac=0.58):
    # PISTÓN HIDRÁULICO: camisa (tubo gordo) + vástago claro (tubo fino) anidados
    a, b = Vector(p0), Vector(p1); m = a + (b-a)*frac
    add_tube(name+"_rod", [tuple(a), tuple(b)], r_rod, mat_r, caps=True)
    add_tube(name+"_cyl", [tuple(a), tuple(m)], r_outer, mat_o, caps=True)

# ---------- construir el critter ----------
frame = mat_frame(); armor = mat_armor(); armor_dk = mat_armor_dk(); panel2 = mat_panel2()
glowS = mat_glow(10)   # tiras / ranuras
glowC = mat_glow(16)   # núcleo / toberas / ojos
front = math.pi/2      # +Y = frente
TAU = 2*math.pi

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

# === CHASIS (elipsoides gunmetal oscuro: el "frame" que asoma entre placas) ===
hrx, hry, hhz = 1.18, 1.28, 0.70
if A.get("head") == 3: hrx, hry = 1.45, 1.15
htap = 1.0 if A.get("head") == 1 else 0.0
head_cz = zb + 0.05
atap = -1.0 if A.get("abdomen") == 1 else -0.6

# SUPERFICIE paramétrica de cada segmento: SIEMPRE registrada (sin malla), porque las
# secciones gateadas de otras masas (p.ej. hombreras/faldones anclados al cuerpo) la usan.
def reg_seg(name, cx, cy, zmid, rx, ry, hz, taper_y=0.0, drop=0.0, flat=0.18):
    SEGS[name] = {"name": name, "ob": None, "cx": cx, "cy": cy, "zmid": zmid,
                  "rx": rx, "ry": ry, "hz": hz, "tapy": taper_y, "drop": drop, "flat": flat}
reg_seg("head", hcx, hcy, head_cz, hrx, hry, hhz, taper_y=htap, drop=0.05)
if hasTh: reg_seg("thorax", tcx, tcy, zb, 1.16, 1.22, 0.62)
if hasAb: reg_seg("abdomen", acx, acy, zb + 0.06, 1.6, 1.82, 0.80, taper_y=atap, drop=0.30)
segH = SEGS.get("head"); segT = SEGS.get("thorax"); segA = SEGS.get("abdomen")
seg_of_row = {0: segH or segT or segA, 1: segT or segH or segA, 2: segA or segT or segH}

if "head" in PARTS:
    add_organic("head", hcx, hcy, head_cz, hrx, hry, hhz, frame, taper_y=htap, drop=0.05)
if "thorax" in PARTS and hasTh:
    add_organic("thorax", tcx, tcy, zb, 1.16, 1.22, 0.62, frame)
if "abdomen" in PARTS and hasAb:
    add_organic("abdomen", acx, acy, zb + 0.06, 1.6, 1.82, 0.80, frame, taper_y=atap, drop=0.30)

# conectores (cuello/cintura): tubos del chasis, gruesos — el TÓRAX es dueño de los puentes
midz = zb
if "thorax" in PARTS:
    if hasTh: add_tube("neck", [(*P2(xC, y0+9), midz), (*P2(xC, y1-9), midz)], 0.13, frame, caps=True)
    if hasTh and hasAb: add_tube("waist", [(*P2(xC, y1+9), midz), (*P2(xC, y2-13), midz)], 0.15, frame, caps=True)
    # SIN TORAX pero CON abdomen: puente DIRECTO cabeza->abdomen (si no, flotan separados).
    if (not hasTh) and hasAb: add_tube("midbridge", [(*P2(xC, y0+9), midz), (*P2(xC, y2-13), midz)], 0.16, frame, caps=True)

# ================= CABEZA: casco blindado + sensores =================
def detail_head(seg):
    # casco envolvente (deja la cara libre) + placa de ceja + carrilleras + mentonera
    add_hull_plate("helm", seg, front+0.72, front+TAU-0.72, 0.16, 0.93, 0.055, 0.07, armor, nu=24, nv=6, flare=0.035)
    add_hull_plate("brow", seg, front-0.72, front+0.72, 0.44, 0.88, 0.06, 0.06, armor, nu=10, nv=4)
    # cresta central clara (dos tonos) asentada sobre el casco
    add_box("crest", (seg["cx"], seg["cy"], seg["zmid"] + seg["hz"]), (0.15, 0.95, 0.11), panel2, bevel=0.02)
    add_hull_plate("cheekR", seg, front+0.66, front+1.38, -0.34, 0.26, 0.05, 0.06, panel2, nu=8, nv=4)
    add_hull_plate("cheekL", seg, front-1.38, front-0.66, -0.34, 0.26, 0.05, 0.06, panel2, nu=8, nv=4)
    add_hull_plate("chin",  seg, front-0.50, front+0.50, -0.68, -0.30, 0.045, 0.06, armor_dk, nu=8, nv=3)
    # remaches del casco: fila simétrica sobre el borde inferior
    add_rivets("hrv", seg, front+1.0, front+TAU-1.0, 0.24, 0.085, 9, r=0.040)
    # barra sensora (visor glow) sobre los ojos
    add_strip("visor", seg, front-0.52, front+0.52, 0.40, 0.085, 0.026, glowS, n=12)

if "head" in PARTS: detail_head(segH)

# MANDÍBULAS (head 2): cuchillas hidráulicas con pistón
if "head" in PARTS and A.get("head") == 2:
    for s in (-1, 1):
        bx, by = P2(xC + s*6.8, y0 - 8); bz = head_cz - 0.06
        dirv = Vector((-s*0.38, 1.0, 0.0)); dirv.normalize()
        g = math.atan2(-dirv.x, dirv.y)            # largo del bloque a lo largo de dirv
        L = 0.92
        cen = Vector((bx, by, bz)) + dirv*(L*0.5)
        add_box("mandb%d" % s, (cen.x, cen.y, cen.z), (0.075, L, 0.24), armor, rot=(0, s*0.18, g), bevel=0.02)
        tip = Vector((bx, by, bz)) + dirv*L
        add_spike("mandt%d" % s, (tip.x, tip.y, tip.z), (dirv.x - s*0.50, dirv.y, -0.18), 0.38, 0.068, panel2)
        # filo energizado: tira glow a lo largo del canto superior de la cuchilla
        e0 = Vector((bx, by, bz)) + dirv*0.10 + Vector((0, 0, 0.13))
        e1 = Vector((bx, by, bz)) + dirv*(L*0.98) + Vector((0, 0, 0.11))
        add_tube("mande%d" % s, [tuple(e0), tuple(e1)], 0.020, glowS)
        pm = Vector((bx, by, bz)) + dirv*(L*0.45) + Vector((0, 0, 0.13))
        add_piston("mandp%d" % s, (s*0.45, hcy + 0.4, head_cz + 0.18), (pm.x, pm.y, pm.z), 0.05, 0.028, frame, panel2)

# ANTENAS → mástiles sensores cortos con punta luminosa
if "antennae" in PARTS and A.get("antennae"):
    for s in (-1, 1):
        b0 = (s*0.32, hcy + 0.15, head_cz + hhz*0.55)
        b1 = (s*0.46, hcy + 0.35, head_cz + hhz + 0.30)
        b2 = (s*0.52, hcy + 0.45, head_cz + hhz + 0.52)
        add_tube("mast%d" % s, [b0, b1], 0.055, frame, caps=True)
        add_tube("mast2%d" % s, [b1, b2], 0.034, panel2, caps=True)
        add_torus("mastr%d" % s, b1[0], b1[1], b1[2], 0.062, 0.062, 0.016, armor)
        add_sphere("mastt%d" % s, b2, 0.062, glowC)

# OJOS: lente sensora luminosa en alojamiento oscuro
if "head" in PARTS:
    eyeY = y0 - 7 if A.get("head") == 3 else y0 - 8
    eyexs = [xC-4.8, xC+4.8] + ([xC] if A.get("head") == 3 else [])
    eye_z = head_cz + hhz*0.32
    for j, ex in enumerate(eyexs):
        e = P2(ex, eyeY); ep = Vector((e[0], e[1], eye_z))
        d = Vector(((ep.x-hcx)/hrx, (ep.y-hcy)/hry, (ep.z-head_cz)/hhz)); d.normalize()
        add_sphere("eyeh%d" % j, (ep.x + d.x*0.04, ep.y + d.y*0.04, ep.z + d.z*0.04), 0.17, frame)
        add_sphere("eye%d" % j,  (ep.x + d.x*0.18, ep.y + d.y*0.18, ep.z + d.z*0.18), 0.105, glowC)

# ================= TÓRAX: losa blindada + núcleo de energía =================
def detail_thorax(seg):
    top = seg["zmid"] + seg["hz"]
    # dos medias-losas (techo panzer) con trinchera central
    for s in (-1, 1):
        add_box("tslab%d" % s,  (s*0.52, tcy, top+0.02), (0.72, 1.30, 0.16), armor,  rot=(0, s*0.14, 0), bevel=0.03)
        add_box("tslab2%d" % s, (s*0.42, tcy, top+0.14), (0.34, 0.92, 0.10), panel2, rot=(0, s*0.14, 0), bevel=0.02)
    # NÚCLEO de energía hundido en la trinchera + collar + aletas radiadoras simétricas
    cyy = tcy - 0.22                       # núcleo un poco hacia atrás para que la cabeza no lo tape
    add_tube("core", [(tcx, cyy, top-0.14), (tcx, cyy, top+0.36)], 0.13, glowC, caps=True, res=6)
    add_torus("corer", tcx, cyy, top+0.22, 0.165, 0.165, 0.034, frame)
    add_torus("corer2", tcx, cyy, top+0.02, 0.19, 0.19, 0.028, armor_dk)
    for k in range(3):
        dy = 0.30 + 0.18*k
        for sgn in (-1, 1):
            add_box("fin%d_%d" % (k, sgn), (tcx, cyy + sgn*dy, top+0.05), (0.30, 0.05, 0.11), frame, bevel=0.008)
    # cinturón lateral envolvente con labio + NEÓN inferior + remaches
    add_hull_plate("tbelt", seg, front+0.55, front+TAU-0.55, -0.30, 0.18, 0.055, 0.07, armor_dk, nu=22, nv=4, flare=0.04)
    add_strip("tbelt_ug", seg, front+0.70, front+TAU-0.70, -0.36, 0.05, 0.020, glowS, n=24)
    add_rivets("trv", seg, front+0.75, front+TAU-0.75, 0.12, 0.085, 10)
    # collar frontal (protege el cuello)
    add_hull_plate("collar", seg, front-0.65, front+0.65, 0.05, 0.42, 0.05, 0.06, armor, nu=8, nv=3)

if "thorax" in PARTS and segT: detail_thorax(segT)

# ================= ABDOMEN: pod reactor con ranuras luminosas =================
def detail_abdomen(seg):
    # placas-aro apiladas (tergitas blindadas) con labios; gaps = chasis oscuro visible
    belts = ((-0.58, -0.24, 0.055, armor_dk), (-0.10, 0.30, 0.065, armor), (0.42, 0.88, 0.075, armor))
    for j, (t0, t1, lf, mt) in enumerate(belts):
        add_hull_plate("abelt%d" % j, seg, front+0.35, front+TAU-0.35, t0, t1, lf, 0.075, mt, nu=26, nv=4, flare=0.03)
    # lomo claro (acento dos tonos) sobre el aro superior, en la espalda
    add_hull_plate("aspine", seg, front+math.pi-0.95, front+math.pi+0.95, 0.46, 0.90, 0.10, 0.05, panel2, nu=12, nv=3)
    # RANURAS DE ENFRIAMIENTO: arcos glow simétricos en los gaps entre aros
    for j, tg in enumerate((-0.17, 0.36)):
        add_strip("aslitR%d" % j, seg, front+0.60, front+1.50, tg, 0.045, 0.024, glowS, n=12)
        add_strip("aslitL%d" % j, seg, front+TAU-1.50, front+TAU-0.60, tg, 0.045, 0.024, glowS, n=12)
    # NEÓN inferior trasero (under-glow del pod)
    add_strip("aug", seg, front+math.pi-1.1, front+math.pi+1.1, -0.62, 0.04, 0.020, glowS, n=16)
    # remaches del aro medio
    add_rivets("arv", seg, front+0.7, front+TAU-0.7, 0.08, 0.10, 12)
    # TOBERAS GEMELAS traseras con resplandor interior
    tail = spos(seg, front+math.pi, 0.0)
    for s in (-1, 1):
        base = Vector((s*0.55, tail.y + 0.60, tail.z + 0.34))
        dirn = Vector((s*0.16, -0.52, -0.05))
        add_tube("thr%d" % s,  [tuple(base), tuple(base + dirn*0.9)], 0.150, frame, caps=True, res=5)
        add_tube("thrc%d" % s, [tuple(base + dirn*0.70), tuple(base + dirn*0.92)], 0.165, armor_dk, caps=True, res=5)
        add_tube("thrg%d" % s, [tuple(base + dirn*0.60), tuple(base + dirn*1.02)], 0.105, glowC, caps=True, res=5)

if "abdomen" in PARTS and segA: detail_abdomen(segA)

# ================= PATAS: struts hidráulicos + hombreras + faldones =================
LEG_CELLS = [(0, -1), (0, 1), (1, -1), (1, 1), (2, -1), (2, 1)]
import os as _osL, sys as _sysL
_sysL.path.append(_osL.path.dirname(_osL.path.abspath(__file__)))
import critter3d_legs as _legmod
_SEL = _legmod.cells_from_mask(_legmask)   # celdas desde la MASCARA (posicion genetica)

# HOMBRERA + FALDÓN: cuelgan SOBRE las patas pero están ANCLADOS a la superficie del
# segmento de su fila (spos/snrm del cuerpo) → pertenecen a la masa dueña (head/thorax/abdomen)
for i in range(legs_n):
    r, side = _SEL[i]
    sg = seg_of_row[r]
    if sg["name"] not in PARTS: continue
    th_s = 0.0 if side > 0 else math.pi
    pp = spos(sg, th_s, 0.30) + snrm(sg, th_s, 0.30)*0.10
    add_box("pald%d" % i,  (pp.x, pp.y, pp.z),       (0.36, 0.52, 0.09), armor,  rot=(0, side*0.55, 0), bevel=0.025)
    add_box("pald2%d" % i, (pp.x - side*0.10, pp.y, pp.z + 0.11), (0.22, 0.36, 0.07), panel2, rot=(0, side*0.55, 0), bevel=0.02)
    ps = spos(sg, th_s, -0.05) + snrm(sg, th_s, -0.05)*0.16
    add_box("skirt%d" % i, (ps.x, ps.y, ps.z - 0.16), (0.07, 0.46, 0.42), armor_dk, rot=(0, -side*0.15, 0), bevel=0.02)
    add_tube("skirtg%d" % i, [(ps.x + side*0.05, ps.y - 0.18, ps.z - 0.38),
                              (ps.x + side*0.05, ps.y + 0.18, ps.z - 0.38)], 0.020, glowS)

for i in range(legs_n if "legs" in PARTS else 0):
    _lb = set(bpy.data.objects)   # taggear SOLO esta pata móvil (NO hombreras/faldones) con su indice
    r, side = _SEL[i]; yy = rowY[r]
    rw = (50 - yy) * 0.1                       # y del mundo de la fila
    dyn = (0.45, 0.0, -0.45)[r]                # postura dinámica: delanteras adelante, traseras atrás
    knee_up = 0.74 if A.get("legStyle") == 1 else 0.54
    hip   = Vector((side*0.9,  rw,            zb*0.85))
    knee  = Vector((side*2.2,  rw + 0.1 + dyn*0.5, seg_z0 + knee_up))
    ankle = Vector((side*3.3,  rw - 0.2 + dyn, seg_z0 + 0.10))
    foot  = Vector((side*3.75, rw - 0.35 + dyn, 0.0))
    # STRUT: cadera + fémur gordo + PISTÓN + rodilla con ANILLO GLOW + tibia + pie stomper
    add_sphere("hip%d" % i, tuple(hip), 0.19, frame)
    add_tube("femur%d" % i, [tuple(hip), tuple(knee)], 0.15, frame, caps=True)
    p_anchor = hip + Vector((side*0.14, 0.05, 0.32))
    p_attach = hip + (knee-hip)*0.78 + Vector((0, 0, 0.16))
    add_piston("fpis%d" % i, tuple(p_anchor), tuple(p_attach), 0.062, 0.034, armor, panel2)
    add_sphere("knee%d" % i, tuple(knee), 0.165, frame)
    add_torus("kneeg%d" % i, knee.x, knee.y, knee.z, 0.175, 0.175, 0.026, glowS)
    add_tube("tibia%d" % i, [tuple(knee), tuple(ankle)], 0.10, frame, caps=True)
    add_sphere("ankle%d" % i, tuple(ankle), 0.105, frame)
    add_torus("ankleg%d" % i, ankle.x, ankle.y, ankle.z, 0.115, 0.115, 0.019, glowS)
    add_tube("tars%d" % i, [tuple(ankle), tuple(foot)], 0.07, frame, caps=True)
    # pie STOMPER: caja ancha + garras + uña trasera + luz de pisada
    d = Vector((foot.x-ankle.x, foot.y-ankle.y, 0.0)); d.normalize()
    perp = Vector((-d.y, d.x, 0.0))
    g = math.atan2(d.y, d.x)
    fc = foot + d*0.05 + Vector((0, 0, 0.058))
    add_box("foot%d" % i, (fc.x, fc.y, fc.z), (0.40, 0.27, 0.11), armor, rot=(0, 0, g), bevel=0.02)
    for ci, sgn in enumerate((-1, 1)):
        cb = foot + d*0.20 + perp*(sgn*0.085) + Vector((0, 0, 0.06))
        add_spike("claw%d_%d" % (i, ci), (cb.x, cb.y, cb.z), (d.x, d.y, -0.55), 0.22, 0.050, panel2)
    hb = foot - d*0.16 + Vector((0, 0, 0.06))
    add_spike("heel%d" % i, (hb.x, hb.y, hb.z), (-d.x, -d.y, -0.5), 0.14, 0.045, panel2)
    g0 = foot + d*0.16 + perp*0.08 + Vector((0, 0, 0.035))
    g1 = foot + d*0.16 - perp*0.08 + Vector((0, 0, 0.035))
    add_tube("footg%d" % i, [tuple(g0), tuple(g1)], 0.018, glowS)
    for _o in (set(bpy.data.objects) - _lb): _o["leg"] = i + 1   # idx 1-based (0 es falsy)

# ---------- escena ----------
def add_area(name, loc, energy, size, color=(1, 1, 1), rot=None):
    l = bpy.data.lights.new(name, 'AREA'); l.energy = energy; l.size = size; l.color = color
    o = bpy.data.objects.new(name, l); o.location = loc; bpy.context.collection.objects.link(o)
    if rot is not None: o.rotation_euler = rot
    else: o.rotation_euler = (Vector((0, 0, 0.4)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()

if "scene" in PARTS:
    add_area("key", (3.5, 4.5, 5.5), 880, 4)        # frente (+Y, lado de la cara)
    add_area("fill", (-4.5, 3, 3), 320, 5)
    add_area("top", (0.5, 0.5, 7.0), 600, 6)        # cenital (saca brillo en los paneles de arriba)
    add_area("rim", (-2.5, -5.5, 3.5), 700, 4, (1.0, 0.55, 0.35))   # atrás (-Y), rim cálido
    add_area("rim2", (4.2555, 7.1332, -2.0159), 600, 4, (1.0, 0.55, 0.35),
             rot=(math.radians(-35.37), math.radians(4.91), math.radians(-8.21)))

    # MUNDO: la cámara ve NEGRO (aislado), pero los reflejos/AO ven un entorno gris → el metal "lee"
    w = bpy.data.worlds.new("w"); bpy.context.scene.world = w; w.use_nodes = True
    nt = w.node_tree; nt.nodes.clear()
    o_w = nt.nodes.new("ShaderNodeOutputWorld"); mix = nt.nodes.new("ShaderNodeMixShader")
    lp = nt.nodes.new("ShaderNodeLightPath")
    bg_k = nt.nodes.new("ShaderNodeBackground"); bg_k.inputs[0].default_value = (0, 0, 0, 1)
    bg_e = nt.nodes.new("ShaderNodeBackground"); bg_e.inputs[0].default_value = (0.22, 0.23, 0.27, 1); bg_e.inputs[1].default_value = 0.7
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(bg_e.outputs[0], mix.inputs[1])
    nt.links.new(bg_k.outputs[0], mix.inputs[2])
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

    # COMPOSITOR: bloom ADITIVO (glare-only sumado encima) → las LUCES florecen sin oscurecer la base
    sc.use_nodes = True
    ct = sc.node_tree
    for n in list(ct.nodes): ct.nodes.remove(n)
    rl = ct.nodes.new("CompositorNodeRLayers")
    gl = ct.nodes.new("CompositorNodeGlare")
    gl.glare_type = 'FOG_GLOW'; gl.quality = 'MEDIUM'; gl.threshold = 1.6; gl.size = 8; gl.mix = 1.0
    mx = ct.nodes.new("CompositorNodeMixRGB"); mx.blend_type = 'ADD'; mx.inputs[0].default_value = 0.65
    cp = ct.nodes.new("CompositorNodeComposite")
    ct.links.new(rl.outputs["Image"], gl.inputs["Image"])
    ct.links.new(rl.outputs["Image"], mx.inputs[1])
    ct.links.new(gl.outputs["Image"], mx.inputs[2])
    ct.links.new(mx.outputs[0], cp.inputs["Image"])

    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    import critter3d_cams
    critter3d_cams.render_views(out_path, spec.get("name"), lens=66.0)
