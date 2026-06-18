# Construye un CRITTER en 3D desde su spec y lo renderiza — variante GUNDAM / Master Grade.
# Hormiga SUPER MECHA: frame interno gunmetal + placas de armadura facetadas a 2/3 tonos,
# juntas servo, pistones hidraulicos, toberas gemelas, reactor expuesto y luces (glow del spec).
# Uso:  blender --background --python critter3d_gundam.py -- <spec.json> <out.png> [samples] [res]
import bpy, bmesh, json, sys, math, random, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
spec_path = argv[0] if len(argv) > 0 else "/tmp/critter_spec.json"
out_path  = argv[1] if len(argv) > 1 else "/tmp/critter3d.png"
opt_samples = int(argv[2]) if len(argv) > 2 else 320     # bajar para iterar rapido
opt_res     = int(argv[3]) if len(argv) > 3 else 1024
spec = json.load(open(spec_path))
A, C = spec["appearance"], spec["colors"]

# GATING por partes (contrato quimera): CHIMERA_PARTS (inyectado por critter3d_chimera.py)
# o CRITTER_PARTS (env) limitan que secciones se construyen; sin ellos = critter completo.
_cp = globals().get("CHIMERA_PARTS") or os.environ.get("CRITTER_PARTS")
PARTS = set(_cp.split(",")) if _cp else {"reset", "head", "thorax", "abdomen", "legs", "antennae", "scene"}

SEGS = []   # geometria de cada segmento del cuerpo (para montar la armadura encima)
def h32(s):  # hash estable (djb2) -> detalle DETERMINISTA por genoma
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

# ---------- materiales (3 tonos mecha + glow + ojos) ----------
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

def mat_frame():    # FRAME interno: gunmetal oscuro (visible entre placas, cuello, cintura, juntas)
    return _principled("frame", (0.055, 0.058, 0.068), 0.85, 0.46)

def mat_armor():    # PLACA principal: casi blanca (tono claro tipo MG)
    return _principled("armor", (0.78, 0.79, 0.82), 0.15, 0.30, coat=0.5)

def mat_accent():   # PLACA acento: color del elemento (derivado de glow+cTop del spec)
    col = tuple(min(1.0, 0.62*g + 0.46*t) for g, t in zip(GLOW, CTOP))
    return _principled("accent", col, 0.35, 0.32, coat=0.45)

def mat_trim():     # TRIM oscuro del elemento (derivado de edge): bordes/garras
    col = tuple(min(1.0, e*1.25 + 0.02) for e in EDGE)
    return _principled("trim", col, 0.55, 0.38)

def mat_rod():      # vastago de piston: cromo claro
    return _principled("rod", (0.85, 0.86, 0.88), 0.95, 0.12)

def mat_glow(strength=9.0):
    nm = "glow%d" % int(strength)
    m = bpy.data.materials.get(nm)
    if m: return m
    m = bpy.data.materials.new(nm); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = (*GLOW, 1); em.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(em.outputs[0], out.inputs[0])
    return m

def mat_eye():   # ojos NEGROS glossy (de hormiga), no emisivos
    return _principled("eye", (0.01, 0.01, 0.01), 0.0, 0.12)

def shade_smooth(me):
    for p in me.polygons: p.use_smooth = True
    if hasattr(me, "use_auto_smooth"):
        me.use_auto_smooth = True; me.auto_smooth_angle = math.radians(40)

def shade_auto(ob, angle_deg=33):   # suave en lo curvo, FILOSO en aristas (hard-surface)
    me = ob.data
    for p in me.polygons: p.use_smooth = True
    if hasattr(me, "use_auto_smooth"):
        me.use_auto_smooth = True
        try: me.auto_smooth_angle = math.radians(angle_deg)
        except Exception: pass
        return
    for o in list(bpy.context.selected_objects): o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    try: ob.select_set(True)
    except Exception: pass
    for opn in ("shade_auto_smooth", "shade_smooth_by_angle"):
        if hasattr(bpy.ops.object, opn):
            try: getattr(bpy.ops.object, opn)(angle=math.radians(angle_deg)); return
            except Exception: pass

# ---------- primitivas hard-surface ----------
def add_tube(name, pts3d, radius, mat):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('POLY'); sp.points.add(len(pts3d) - 1)
    for i, (x, y, z) in enumerate(pts3d): sp.points[i].co = (x, y, z, 1)
    cu.bevel_depth = radius; cu.bevel_resolution = 3; cu.fill_mode = 'FULL'
    ob = bpy.data.objects.new(name, cu); bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat); return ob

def add_diamond(name, loc, size, mat):
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    bm = bmesh.new(); s = size
    top = bm.verts.new((0, 0, s)); bot = bm.verts.new((0, 0, -s))
    mid = [bm.verts.new((s, 0, 0)), bm.verts.new((0, s, 0)), bm.verts.new((-s, 0, 0)), bm.verts.new((0, -s, 0))]
    for i in range(4):
        bm.faces.new([top, mid[i], mid[(i+1)%4]]); bm.faces.new([bot, mid[(i+1)%4], mid[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    ob.location = loc; ob.data.materials.append(mat); shade_smooth(me); return ob

def add_sphere(name, loc, radius, mat):
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    try: bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius)
    except TypeError: bmesh.ops.create_icosphere(bm, subdivisions=2, diameter=radius * 2)
    bm.to_mesh(me); bm.free()
    ob.location = loc; ob.data.materials.append(mat); shade_smooth(me); return ob

def add_cyl(name, loc, axis, r1, depth, mat, r2=None, segs=24, bevel=0.012):
    # cilindro/tobera orientado: eje local Z -> 'axis'; r1 en la base (-Z), r2 en la salida (+Z)
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                          radius1=r1, radius2=(r1 if r2 is None else r2), depth=depth)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(me); bm.free()
    ob.location = loc
    d = Vector(axis)
    if d.length > 1e-6: ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    ob.data.materials.append(mat)
    if bevel > 0:
        bv = ob.modifiers.new("bevel", "BEVEL"); bv.width = bevel; bv.segments = 2
    shade_auto(ob, 35); return ob

def add_facet_plate(name, loc, size, mat, rot=None, top=0.68, bevel=0.018):
    # PLACA FACETADA tipo gundam: caja con la cara superior reducida (chaflanes) + bevel
    sx, sy, sz = size
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    B = [bm.verts.new((s1*sx, s2*sy, -sz)) for (s1, s2) in ((1,1),(1,-1),(-1,-1),(-1,1))]
    T = [bm.verts.new((s1*sx*top, s2*sy*top, sz)) for (s1, s2) in ((1,1),(1,-1),(-1,-1),(-1,1))]
    bm.faces.new(B[::-1]); bm.faces.new(T)
    for i in range(4): bm.faces.new([B[i], B[(i+1)%4], T[(i+1)%4], T[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(me); bm.free()
    ob.location = loc
    if rot is not None: ob.rotation_euler = rot
    ob.data.materials.append(mat)
    if bevel > 0:
        bv = ob.modifiers.new("bevel", "BEVEL"); bv.width = bevel; bv.segments = 2
    shade_auto(ob, 30); return ob

def add_blade(name, base, tip, w_main, w_thin, mat, up=(0, 0, 1), tipw=0.18):
    # HOJA/ALETA: base rectangular (ancha x fina) que converge a un filo en la punta
    b = Vector(base); t = Vector(tip); d = t - b
    u = Vector(up)
    ax = d.cross(u)
    if ax.length < 1e-5: ax = d.cross(Vector((1, 0, 0)))
    ax.normalize(); ay = d.cross(ax); ay.normalize()
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    B = [bm.verts.new((*(b + ax*w_main + ay*w_thin),)), bm.verts.new((*(b + ax*w_main - ay*w_thin),)),
         bm.verts.new((*(b - ax*w_main - ay*w_thin),)), bm.verts.new((*(b - ax*w_main + ay*w_thin),))]
    T0 = bm.verts.new((*(t + ax*w_main*tipw),)); T1 = bm.verts.new((*(t - ax*w_main*tipw),))
    bm.faces.new(B[::-1])
    bm.faces.new([B[0], B[1], T0]); bm.faces.new([B[2], B[3], T1])
    bm.faces.new([B[3], B[0], T0, T1]); bm.faces.new([B[1], B[2], T1, T0])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(me); bm.free()
    ob.data.materials.append(mat)
    bv = ob.modifiers.new("bevel", "BEVEL"); bv.width = 0.012; bv.segments = 2
    shade_auto(ob, 30); return ob

def add_ring(name, cx, cy, z, rx, ry, radius, mat, nseg=56):   # anillo horizontal (acople)
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('POLY'); sp.points.add(nseg - 1)
    for i in range(nseg):
        a = 2*math.pi*i/nseg
        sp.points[i].co = (cx + rx*math.cos(a), cy + ry*math.sin(a), z, 1)
    sp.use_cyclic_u = True
    cu.bevel_depth = radius; cu.bevel_resolution = 2; cu.fill_mode = 'FULL'
    ob = bpy.data.objects.new(name, cu); bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat); return ob

def seg_surface(seg, theta, t):
    # punto + normal EXACTOS sobre la superficie organica del segmento (misma parametrizacion
    # que add_organic) -> las placas ABRAZAN el cuerpo en vez de leer como discos conicos.
    su = seg["surf"]
    p = su(theta, t)
    d_th = su(theta + 0.012, t) - p
    t2 = t + 0.012
    if t2 > 0.985: d_t = p - su(theta, t - 0.012)
    else:          d_t = su(theta, t2) - p
    n = d_th.cross(d_t)
    if n.length < 1e-9: n = Vector((math.cos(theta), math.sin(theta), 0))
    n.normalize()
    return p, n

def add_shell_plate(name, seg, th0, th1, t0, t1, lift, thick, flare, mat, nu=14, nv=4, bevel=0.02):
    # PLACA-CORAZA curva: sigue la superficie del segmento entre [th0,th1]x[t0,t1], levantada 'lift'
    # hacia afuera y con el BORDE INFERIOR saliente ('flare') -> labio que solapa la placa de abajo.
    bm = bmesh.new()
    O = [[None]*(nv+1) for _ in range(nu+1)]; I = [[None]*(nv+1) for _ in range(nu+1)]
    for iu in range(nu+1):
        th = th0 + (th1-th0)*iu/nu
        for iv in range(nv+1):
            f = iv/nv; t = t0 + (t1-t0)*f
            loc, nrm = seg_surface(seg, th, t)
            lf = lift + flare*(1-f)                       # mas saliente abajo (en t0)
            o = loc + nrm*lf; inn = loc + nrm*(lf - thick)
            O[iu][iv] = bm.verts.new((o.x, o.y, o.z)); I[iu][iv] = bm.verts.new((inn.x, inn.y, inn.z))
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
    shade_smooth(me); return ob

def add_organic(name, cx, cy, zmid, rx, ry, hz, mat, taper_y=0.0, drop=0.0, flat=0.18, sub=3):
    # CUERPO base del FRAME: elipsoide suave. taper_y!=0 afina una punta hacia +Y(>0)/-Y(<0)=lagrima.
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    try: bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    except TypeError: bmesh.ops.create_icosphere(bm, subdivisions=sub, diameter=2.0)
    sgn = 1.0 if taper_y >= 0 else -1.0
    for v in bm.verts:
        x, y, z = v.co
        wx, wy, wz = x*rx, y*ry, z*hz
        if taper_y != 0:
            f = max(0.0, y*sgn); k = f**1.4     # 0..1 hacia la punta (lagrima)
            wx *= (1 - 0.82*k); wy *= (1 + 0.20*f); wz = wz*(1 - 0.4*k) - drop*k
        if z < 0: wz *= (1 - flat*(-z))         # base un poco aplanada
        v.co = (cx+wx, cy+wy, zmid+wz)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(me); bm.free()
    ob.data.materials.append(mat); shade_auto(ob, 40)
    def surf(theta, t, _sgn=sgn):   # superficie parametrica (theta = acimut, t = -1..1 vertical)
        s = math.sqrt(max(1e-4, 1 - t*t))
        ux, uy, uz = s*math.cos(theta), s*math.sin(theta), t
        wx, wy, wz = ux*rx, uy*ry, uz*hz
        if taper_y != 0:
            f = max(0.0, uy*_sgn); k = f**1.4
            wx *= (1 - 0.82*k); wy *= (1 + 0.20*f); wz = wz*(1 - 0.4*k) - drop*k
        if uz < 0: wz *= (1 - flat*(-uz))
        return Vector((cx+wx, cy+wy, zmid+wz))
    seg = {"name": name, "ob": ob, "cx": cx, "cy": cy, "zmid": zmid, "hz": hz,
           "zg": zmid, "ztop": zmid+hz, "zbot": zmid-hz, "rx": rx, "ry": ry, "surf": surf}
    SEGS.append(seg); return seg

def lip_strip(name, seg, th0, th1, t, lift, radius, mat, n=13):
    pts = []
    for k in range(n):
        th = th0 + (th1-th0)*k/(n-1)
        loc, nrm = seg_surface(seg, th, t); o = loc + nrm*lift
        pts.append((o.x, o.y, o.z))
    return add_tube(name, pts, radius, mat)

# ---------- construir el critter ----------
frame = mat_frame(); armor = mat_armor(); accent = mat_accent(); trim = mat_trim(); rodm = mat_rod()
eye_mat = mat_eye()
glow  = mat_glow(9)     # acentos generales
glowR = mat_glow(14)    # reactor
glowT = mat_glow(22)    # toberas
FRONT = math.pi/2       # +Y = frente

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
zb = seg_z0 + 0.50                       # centro vertical del cuerpo
hcx, hcy = P2(xC, y0); tcx, tcy = P2(xC, y1); acx, acy = P2(xC, y2)

def mirror_th(a, b):   # rango espejo de (FRONT+a, FRONT+b) respecto del plano de simetria
    return (FRONT - b, FRONT - a)

# === CABEZA: frame + craneo blindado + V-fin + visor glow + ojos negros ===
# dimensiones de la cabeza FUERA del gate: las antenas (otra parte) usan head_cz/hhz/topz
hrx, hry, hhz = 1.18, 1.28, 0.70
if A.get("head") == 3: hrx, hry = 1.45, 1.15
htap = 1.0 if A.get("head") == 1 else 0.0
head_cz = zb + 0.05
topz = head_cz + hhz

if "head" in PARTS:
    HEAD = add_organic("head", hcx, hcy, head_cz, hrx, hry, hhz, frame, taper_y=htap, drop=0.05)

    # placas craneales (par espejado, dejan la cara y la corona del frame a la vista)
    _cr = (0.85, math.pi - 0.12)
    add_shell_plate("head_cranL", HEAD, FRONT+_cr[0], FRONT+_cr[1], 0.02, 0.72, 0.05, 0.06, 0.08, armor, nu=12)
    add_shell_plate("head_cranR", HEAD, *mirror_th(*_cr), 0.02, 0.72, 0.05, 0.06, 0.08, armor, nu=12)
    # placa trasera baja (cruza la linea media trasera: simetrica)
    add_shell_plate("head_rear", HEAD, FRONT+math.pi-0.85, FRONT+math.pi+0.85, -0.48, -0.02, 0.06, 0.06, 0.10, accent, nu=14)
    # carrilleras (mejillas)
    _ck = (0.28, 0.80)
    add_shell_plate("head_cheekL", HEAD, FRONT+_ck[0], FRONT+_ck[1], -0.38, 0.10, 0.05, 0.05, 0.07, accent, nu=8)
    add_shell_plate("head_cheekR", HEAD, *mirror_th(*_ck), -0.38, 0.10, 0.05, 0.05, 0.07, accent, nu=8)
    # ceja blindada blanca sobre el visor (enmarca la cara)
    add_shell_plate("head_brow", HEAD, FRONT-0.62, FRONT+0.62, 0.46, 0.66, 0.05, 0.05, 0.07, armor, nu=10)
    # menton (guardia baja)
    add_shell_plate("head_chin", HEAD, FRONT-0.45, FRONT+0.45, -0.42, -0.16, 0.05, 0.05, 0.06, accent, nu=8)

    # V-FIN: cresta sensora en V sobre la frente + joya glow central
    vbase, vn = seg_surface(HEAD, FRONT, 0.72)
    vb = vbase + vn*0.04
    for s in (-1, 1):
        tip = vb + Vector((s*0.62, 0.34, 0.55))
        add_blade("vfin%d" % s, (*vb,), (*tip,), 0.18, 0.026, accent, up=(1, 0, 0))
    add_diamond("vjewel", (vb.x, vb.y + 0.03, vb.z + 0.02), 0.10, mat_glow(14))

    # VISOR: tira sensora glow que cruza la cara (ademas de los ojos negros de hormiga)
    lip_strip("visor", HEAD, FRONT-0.62, FRONT+0.62, 0.34, 0.045, 0.05, mat_glow(22), n=13)

    # ojos esfericos negros (anatomia de hormiga)
    eyeY = y0 - 7 if A.get("head") == 3 else y0 - 8
    eyexs = [xC-4.8, xC+4.8] + ([xC] if A.get("head") == 3 else [])
    eye_z = head_cz + hhz*0.30
    for j, ex in enumerate(eyexs):
        e = P2(ex, eyeY); add_sphere("eye%d" % j, (e[0], e[1], eye_z), 0.17, eye_mat)

    # MANDIBULAS (head 2): hojas hidraulicas largas — servo en la raiz + hoja + piston
    if A.get("head") == 2:
        for s in (-1, 1):
            root = Vector((*P2(xC + s*6, y0-8), head_cz - 0.10))
            add_cyl("mandservo%d" % s, (*root,), (0, 0, 1), 0.11, 0.18, frame)         # junta vertical
            add_cyl("mandservog%d" % s, (root.x, root.y, root.z), (0, 0, 1), 0.115, 0.045, glow)  # aro glow
            tip = Vector((*P2(xC + s*3.5, y0-30), head_cz - 0.06))
            mid = root.lerp(tip, 0.45) + Vector((s*0.16, 0, 0.02))
            add_blade("mandible%d" % s, (*mid,), (*tip,), 0.14, 0.035, accent, up=(1, 0, 0))
            add_blade("mandible_in%d" % s, tuple(root + Vector((0, -0.05, 0))), tuple(mid + Vector((0, -0.18, 0))), 0.12, 0.045, frame, up=(1, 0, 0), tipw=0.7)
            # piston: cuerpo + vastago desde la mejilla a la hoja
            a = root + Vector((s*0.22, 0.10, 0.16)); b = mid + Vector((0, 0.1, 0.10))
            add_tube("mandpist%d" % s, [(*a,), (*a.lerp(b, 0.55),)], 0.040, frame)
            add_tube("mandrod%d" % s, [(*a.lerp(b, 0.5),), (*b,)], 0.022, rodm)

# === TORAX: frame + hombreras + reactor expuesto en el lomo ===
if "thorax" in PARTS and hasTh:
    TH = add_organic("thorax", tcx, tcy, zb, 1.16, 1.22, 0.62, frame)
    # placas dorso-laterales (par espejado, separadas del frame: se ve el gunmetal debajo)
    _dp = (0.30, math.pi - 0.30)
    add_shell_plate("th_dorsL", TH, FRONT+_dp[0], FRONT+_dp[1], 0.12, 0.72, 0.06, 0.06, 0.09, armor, nu=12)
    add_shell_plate("th_dorsR", TH, *mirror_th(*_dp), 0.12, 0.72, 0.06, 0.06, 0.09, armor, nu=12)
    # faldones laterales bajos (acento) sobre las raices de las patas
    _sk = (0.55, math.pi - 0.55)
    add_shell_plate("th_sideL", TH, FRONT+_sk[0], FRONT+_sk[1], -0.52, 0.00, 0.06, 0.06, 0.11, accent, nu=10)
    add_shell_plate("th_sideR", TH, *mirror_th(*_sk), -0.52, 0.00, 0.06, 0.06, 0.11, accent, nu=10)
    # TOMAS DE AIRE laterales: tres lamas apiladas por lado (espejadas)
    for sd, ths in (("L", FRONT + math.pi/2), ("R", FRONT - math.pi/2)):
        for vi, tv in enumerate((0.06, 0.20, 0.34)):
            loc, n = seg_surface(TH, ths, tv)
            rot = n.to_track_quat('Z', 'Y').to_euler()
            add_facet_plate("vent%s%d" % (sd, vi), (*(loc + n*0.10),), (0.045, 0.20, 0.022), trim, rot=rot, top=0.8)
    # REACTOR expuesto: torre del frame + nucleo glow ALTO (visible entre los domos), aro y grapas
    rz = zb + 0.62
    add_cyl("reactor_well", (tcx, tcy, rz - 0.02), (0, 0, 1), 0.34, 0.14, frame, segs=28)
    add_cyl("reactor_ped", (tcx, tcy, rz + 0.10), (0, 0, 1), 0.20, 0.36, frame, segs=24)
    add_cyl("reactor", (tcx, tcy, rz + 0.30), (0, 0, 1), 0.27, 0.20, glowT, segs=28)
    add_ring("reactor_rim", tcx, tcy, rz + 0.34, 0.335, 0.335, 0.05, frame)
    for k in range(4):
        a = FRONT + math.pi/4 + k*math.pi/2     # grapas a 45 grados: simetricas
        add_facet_plate("rclamp%d" % k, (tcx + 0.33*math.cos(a), tcy + 0.33*math.sin(a), rz + 0.36),
                        (0.06, 0.12, 0.034), frame, rot=(0, 0, a))

# === ABDOMEN: lagrima frame + bandas de armadura solapadas + aletas + TOBERAS ===
if "abdomen" in PARTS and hasAb:
    atap = -1.0 if A.get("abdomen") == 1 else -0.6
    AB = add_organic("abdomen", acx, acy, zb + 0.02, 1.5, 1.78, 0.74, frame, taper_y=atap, drop=0.30)
    g = 0.08     # huequito en las lineas medias (costura de panel simetrica)
    bands = [   # (t0, t1, mat, lip_glow)
        (0.46, 0.86, armor,  False),
        (0.10, 0.40, accent, True),
        (-0.28, 0.04, armor, True),
        (-0.64, -0.34, accent, False),
    ]
    for bi, (t0, t1, m, lipg) in enumerate(bands):
        th = (g, math.pi - g)
        add_shell_plate("ab_b%dL" % bi, AB, FRONT+th[0], FRONT+th[1], t0, t1, 0.055, 0.055, 0.10, m, nu=14)
        add_shell_plate("ab_b%dR" % bi, AB, *mirror_th(*th), t0, t1, 0.055, 0.055, 0.10, m, nu=14)
        if lipg:
            lip_strip("ab_lip%dL" % bi, AB, FRONT+th[0]+0.1, FRONT+th[1]-0.1, t0, 0.16, 0.024, mat_glow(14), n=11)
            lip_strip("ab_lip%dR" % bi, AB, FRONT-th[1]+0.1, FRONT-th[0]-0.1, t0, 0.16, 0.024, mat_glow(14), n=11)
    # aletas dorsales sobre la linea media (en el plano de simetria)
    for i, (thf, tf) in enumerate(((FRONT, 0.80), (FRONT, 0.97), (FRONT+math.pi, 0.78))):
        bloc, bn = seg_surface(AB, thf, tf)
        base = bloc - bn*0.06
        tip = base + Vector((0, -0.30, 0.55 - i*0.06))
        add_blade("abfin%d" % i, (*base,), (*tip,), 0.20, 0.030, accent if i == 1 else armor, up=(1, 0, 0))
    # TOBERAS GEMELAS tipo mochila: altas sobre la cola, apuntan atras-arriba -> rompen la silueta
    for s in (-1, 1):
        mount = Vector((acx + s*0.46, acy - 1.15, zb + 0.62))
        axis = Vector((s*0.28, -1.0, 0.22)); axis.normalize()
        add_cyl("thr%d" % s, (*mount,), (*axis,), 0.12, 0.56, frame, r2=0.26, segs=24)
        add_cyl("thrg%d" % s, (*(mount + axis*0.20),), (*axis,), 0.165, 0.36, glowT, segs=20, bevel=0)
        add_cyl("thrring%d" % s, (*(mount + axis*0.29),), (*axis,), 0.265, 0.05, accent, segs=24)

# conectores FRAME (cuello/cintura): tubo + discos servo + disco glow (frame a la vista)
def connector(nm, pA, pB, r):
    a = Vector(pA); b = Vector(pB); d = b - a
    add_tube(nm, [(*a,), (*b,)], r, frame)
    for f, mt, rr, dd in ((0.28, frame, r*1.9, 0.07), (0.72, frame, r*1.9, 0.07), (0.5, glow, r*1.55, 0.035)):
        p = a.lerp(b, f)
        add_cyl(nm + "_d%d" % int(f*100), (*p,), (*d,), rr, dd, mt)

# los conectores cuello/cintura son del TORAX (dueno de los puentes entre masas)
midz = zb
if "thorax" in PARTS:
    if hasTh: connector("neck", (*P2(xC, y0+9), midz), (*P2(xC, y1-9), midz), 0.09)
    if hasTh and hasAb: connector("waist", (*P2(xC, y1+9), midz), (*P2(xC, y2-13), midz), 0.10)
    # SIN TORAX pero CON abdomen: puente DIRECTO cabeza->abdomen (si no, flotan separados).
    if (not hasTh) and hasAb: connector("midbridge", (*P2(xC, y0+9), midz), (*P2(xC, y2-13), midz), 0.12)

# === PATAS: frame + servos cilindricos + pistones hidraulicos + placas + garras ===
LEG_CELLS = [(0, -1), (0, 1), (1, -1), (1, 1), (2, -1), (2, 1)]
def leg_axis(d):   # eje de bisagra: horizontal, perpendicular a la pata
    ax = Vector((d.y, -d.x, 0))
    if ax.length < 1e-5: ax = Vector((1, 0, 0))
    ax.normalize(); return ax

def piston(nm, a, b, f0, f1, rbody, rrod):
    # piston hidraulico: cuerpo grueso de f0..fm + vastago fino de fm..f1 (tubos anidados)
    fm = f0 + (f1-f0)*0.55
    add_tube(nm + "_c", [(*a.lerp(b, f0),), (*a.lerp(b, fm),)], rbody, frame)
    add_tube(nm + "_r", [(*a.lerp(b, fm-0.04),), (*a.lerp(b, f1),)], rrod, rodm)

import os as _osL, sys as _sysL
_sysL.path.append(_osL.path.dirname(_osL.path.abspath(__file__)))
import critter3d_legs as _legmod
_SEL = _legmod.cells_from_mask(_legmask)   # celdas desde la MASCARA (posicion genetica)
if "legs" in PARTS:
    for i in range(legs_n):
        _lb = set(bpy.data.objects)   # taggear esta pata con su INDICE (para animarla en cams)
        r, side = _SEL[i]; yy = rowY[r]
        knee_up = 0.74 if A.get("legStyle") == 1 else 0.54
        hip   = Vector((*P2(xC + side*9,  yy),     zb*0.85))
        knee  = Vector((*P2(xC + side*22, yy-1),   seg_z0 + knee_up))
        ankle = Vector((*P2(xC + side*33, yy+2),   seg_z0 + 0.14))
        foot  = Vector((*P2(xC + side*37, yy+4),   0.0))
        df = knee - hip; dt = ankle - knee; dts = foot - ankle
        axf = leg_axis(df); axt = leg_axis(dt)
        # CADERA: servo cilindrico plano + aro glow central + tapas blindadas
        add_cyl("hip%d" % i, (*hip,), (*axf,), 0.155, 0.24, frame)
        add_cyl("hipg%d" % i, (*hip,), (*axf,), 0.172, 0.05, mat_glow(14), bevel=0)
        for cs in (-1, 1):
            add_cyl("hipcap%d_%d" % (i, cs), (*(hip + axf*(0.135*cs)),), (*axf,), 0.10, 0.035, armor, segs=18)
        # FEMUR: tubo frame + placa muslo facetada + piston
        add_tube("femur%d" % i, [(*hip,), (*knee,)], 0.085, frame)
        qf = df.to_track_quat('Y', 'Z'); upf = qf.to_matrix() @ Vector((0, 0, 1))
        cf = hip.lerp(knee, 0.5) + upf*0.13
        add_facet_plate("thigh%d" % i, (*cf,), (0.13, df.length*0.30, 0.055), armor, rot=qf.to_euler())
        piston("fpist%d" % i, hip + upf*(-0.10), knee + upf*(-0.06), 0.12, 0.92, 0.048, 0.026)
        # RODILLA: servo + aro glow + tapas blindadas
        add_cyl("knee%d" % i, (*knee,), (*axt,), 0.125, 0.20, frame)
        add_cyl("kneeg%d" % i, (*knee,), (*axt,), 0.14, 0.045, mat_glow(14), bevel=0)
        for cs in (-1, 1):
            add_cyl("kneecap%d_%d" % (i, cs), (*(knee + axt*(0.115*cs)),), (*axt,), 0.082, 0.030, armor, segs=18)
        # TIBIA: tubo + placa canilla + piston corto
        add_tube("tibia%d" % i, [(*knee,), (*ankle,)], 0.06, frame)
        qt = dt.to_track_quat('Y', 'Z'); upt = qt.to_matrix() @ Vector((0, 0, 1))
        ct = knee.lerp(ankle, 0.45) + upt*0.10
        add_facet_plate("shin%d" % i, (*ct,), (0.095, dt.length*0.26, 0.045), accent, rot=qt.to_euler())
        piston("tpist%d" % i, knee + upt*(-0.08), ankle + upt*(-0.03), 0.15, 0.85, 0.036, 0.020)
        # TOBILLO + tarso + GARRA (pie de garra con espolon)
        add_cyl("ankle%d" % i, (*ankle,), (*axt,), 0.075, 0.12, frame)
        add_tube("tars%d" % i, [(*ankle,), (*foot,)], 0.04, frame)
        dh = Vector((dts.x, dts.y, 0))
        if dh.length > 1e-5: dh.normalize()
        upc = (dh.y, -dh.x, 0)
        add_blade("claw%d" % i, tuple(foot + Vector((0, 0, 0.10)) - dh*0.05), tuple(foot + dh*0.30 + Vector((0, 0, -0.01))), 0.075, 0.028, trim, up=upc)
        add_blade("spur%d" % i, tuple(foot + Vector((0, 0, 0.09))), tuple(foot - dh*0.17 + Vector((0, 0, 0.01))), 0.055, 0.022, trim, up=upc)
        add_diamond("ftip%d" % i, tuple(foot + Vector((0, 0, 0.04))), 0.05, glow)
        for _o in (set(bpy.data.objects) - _lb): _o["leg"] = i + 1   # idx 1-based (0 es falsy)

# === ANTENAS: mastiles sensores segmentados con punta glow ===
if "antennae" in PARTS and A.get("antennae"):
    for s in (-1, 1):
        p0 = Vector((*P2(xC + s*3, y0+1),  head_cz + hhz*0.2))   # raiz DENTRO de la cabeza
        p1 = Vector((*P2(xC + s*5, y0-7),  topz*0.98))
        p2 = Vector((*P2(xC + s*8, y0-16), topz+0.40))
        p3 = Vector((*P2(xC + s*6, y0-24), topz+0.78))
        add_tube("antA%d" % s, [(*p0,), (*p1,), (*p2,)], 0.038, frame)
        add_cyl("antj%d" % s, (*p2,), (*(p3-p2),), 0.055, 0.05, accent)     # junta del mastil
        add_tube("antB%d" % s, [(*p2,), (*p3,)], 0.024, rodm)
        add_sphere("anttip%d" % s, (*p3,), 0.06, mat_glow(14))

# ---------- escena ----------
def add_area(name, loc, energy, size, color=(1, 1, 1), rot=None):
    l = bpy.data.lights.new(name, 'AREA'); l.energy = energy; l.size = size; l.color = color
    o = bpy.data.objects.new(name, l); o.location = loc; bpy.context.collection.objects.link(o)
    if rot is not None: o.rotation_euler = rot
    else: o.rotation_euler = (Vector((0, 0, 0.4)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()

if "scene" in PARTS:
    add_area("key", (3.5, 4.5, 5.5), 600, 4)        # frente (+Y, lado de la cara)
    add_area("fill", (-4.5, 3, 3), 200, 5)
    add_area("top", (0.5, 0.5, 7.0), 350, 6)        # cenital (saca brillo en las placas)
    add_area("rim", (-2.5, -5.5, 3.5), 700, 4, (1.0, 0.55, 0.35))   # atras (-Y), rim calido
    add_area("rim2", (4.2555, 7.1332, -2.0159), 600, 4, (1.0, 0.55, 0.35),
             rot=(math.radians(-35.37), math.radians(4.91), math.radians(-8.21)))

    # MUNDO: la camara ve NEGRO (aislado), pero reflejos/AO ven un entorno gris -> el metal "lee"
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
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    import critter3d_cams
    critter3d_cams.render_views(out_path, spec.get("name"), lens=60.0)
