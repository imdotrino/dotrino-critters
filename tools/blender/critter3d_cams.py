# Camaras COMPARTIDAS por los 3 estilos: encuadre AUTOMATICO al bounding box de la criatura
# (nunca se cortan las patas; una criatura con menos partes sale centrada) y render MULTI-VISTA:
#   <out>.png        vista 3/4 "beauty" (fondo negro)
#   <out>_top.png    VISTA SUPERIOR ortografica, cabeza (+Y) hacia ARRIBA de la imagen,
#                    fondo TRANSPARENTE -> lista para usar en el juego (misma vista que el SVG 2D)
#   <out>_side.png   perfil lateral, cabeza hacia la derecha (fondo negro)
# El .blend editable se guarda con las 3 camaras (la activa es la beauty).
import bpy, math
from mathutils import Vector, Matrix

def _coords():
    # esquinas de bbox por objeto, EVALUADAS (con bevel/subsurf aplicados) y en mundo
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for ob in bpy.context.scene.objects:
        if ob.type not in ('MESH', 'CURVE'): continue
        eo = ob.evaluated_get(dg)
        mw = eo.matrix_world
        out += [mw @ Vector(c) for c in eo.bound_box]
    return out

def _make_cam(name, rot, lens=60.0, ortho=False):
    d = bpy.data.cameras.new(name)
    if ortho: d.type = 'ORTHO'
    else: d.lens = lens
    d.clip_end = 200
    ob = bpy.data.objects.new(name, d); bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = rot
    return ob

def _fit(cam, coords, margin):
    # camera_fit_coords RESPETA la rotacion de la camara y devuelve la posicion (y la escala
    # ortografica) de encuadre exacto; el margen deja aire alrededor de la silueta.
    dg = bpy.context.evaluated_depsgraph_get()
    flat = [f for v in coords for f in v]
    loc, scale = cam.camera_fit_coords(dg, flat)
    cam.location = loc
    if cam.data.type == 'ORTHO':
        cam.data.ortho_scale = scale * margin
    else:
        ctr = sum(coords, Vector()) / len(coords)
        cam.location = ctr + (loc - ctr) * margin

# --- Animacion de patas (3 frames: -SWING, 0, +SWING) ------------------------------
# Cada pata gira sobre SU PROPIA cadera (no el cuerpo en bloque), un yaw que en vista top
# mece el pie adelante/atras. Los signos van en patron TRIPODE (intercalado) para conservar
# el equilibrio: patas vecinas van en sentidos opuestos. Tag ["leg"]=i+1 (1-based: el 0 es
# falsy) lo pone cada estilo en sus objetos de pata; la cadera se infiere como el objeto del
# grupo mas cercano al centro del cuerpo. El framerate lo decide el juego (3 frames ping-pong).
SWING = math.radians(14.0)

def _leg_objs():
    return [o for o in bpy.context.scene.objects if o.type in ('MESH', 'CURVE') and o.get("leg")]

def _leg_groups(legs, ctr):
    # agrupa por indice de pata y calcula el pivote (cadera = objeto mas cercano al centro).
    groups = {}
    for o in legs:
        groups.setdefault(int(o["leg"]) - 1, []).append(o)
    out = []
    for idx, objs in groups.items():
        hip = min(objs, key=lambda o: (o.matrix_world.translation.xy - ctr.xy).length)
        p = hip.matrix_world.translation
        # signo TRIPODE por POSICION de la cadera (las celdas se mezclan por semilla, así que
        # el indice ya no es la fila/lado): patron DIAGONAL -> espejo izq/der siempre opuestas
        # y delante/detras opuestas, conservando el equilibrio.
        sx = 1.0 if p.x >= ctr.x else -1.0
        sy = 1.0 if p.y >= ctr.y else -1.0
        out.append((objs, Vector((p.x, p.y, 0.0)), sx * sy))
    return out

def _pose_legs(groups, base_mw, theta):
    for objs, pivot, sign in groups:
        ang = theta * sign
        M = Matrix.Translation(pivot) @ Matrix.Rotation(ang, 4, 'Z') @ Matrix.Translation(-pivot)
        for o in objs:
            o.matrix_world = (base_mw[o.name] if ang == 0.0 else M @ base_mw[o.name])
    bpy.context.view_layer.update()

def _fit_top(cam, coords, margin):
    # VISTA SUPERIOR: centrar SOLO en vertical (centro del bbox en Y); en horizontal se
    # fija al eje del cuerpo (X=0, la línea de simetría) en vez del centro del bbox. Así el
    # cuerpo no se corre de lado por asimetrías (antenas/mandíbulas) ni "salta" entre los
    # frames de la animación: solo se mueven las patas.
    xs = [c.x for c in coords]; ys = [c.y for c in coords]
    halfx = max(abs(min(xs)), abs(max(xs)))      # medio ancho simétrico respecto a X=0
    ymin, ymax = min(ys), max(ys)
    cy = (ymin + ymax) / 2.0
    zmax = max(c.z for c in coords)
    cam.location = Vector((0.0, cy, zmax + 50.0))
    cam.data.ortho_scale = max(2.0 * halfx, ymax - ymin) * margin

def render_views(out_path, name, lens=60.0, views=None):
    import os
    sc = bpy.context.scene
    coords = _coords()
    base = out_path.rsplit('.', 1)[0]
    beauty = _make_cam("cam", (math.radians(77.36), 0.0, math.radians(152.54)), lens=lens)
    top    = _make_cam("camTop", (0.0, 0.0, 0.0), ortho=True)            # cenital exacta, +Y arriba
    side   = _make_cam("camSide", (math.radians(82.0), 0.0, math.radians(90.0)), lens=lens)
    _fit(beauty, coords, 1.09); _fit_top(top, coords, 1.12); _fit(side, coords, 1.09)
    sc.camera = beauty
    blend_path = base + '.blend'
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print("SAVED BLEND", blend_path, flush=True)

    # Catalogo de vistas: clave -> (camara, fondo_transparente, archivo, angulo_de_patas).
    # 3 frames de animacion por vista: "1" = +SWING, base = 0 (neutro), "2" = -SWING. El
    # juego hace ping-pong 1->base->2->base (de -x/2 a x/2 pasando por el centro).
    JOBS = {
        'beauty':  (beauty, True,  out_path,            0.0),
        'top':     (top,    True,  base + '_top.png',   0.0),
        'side':    (side,   False, base + '_side.png',  0.0),
        'top1':    (top,    True,  base + '_top1.png',  +SWING),
        'top2':    (top,    True,  base + '_top2.png',  -SWING),
        'beauty1': (beauty, True,  base + '_b1.png',    +SWING),
        'beauty2': (beauty, True,  base + '_b2.png',    -SWING),
    }
    if views is None:
        views = (os.environ.get("CRITTER_VIEWS", "").split(",") if os.environ.get("CRITTER_VIEWS")
                 else ['beauty', 'top', 'side'])
    views = [v for v in views if v in JOBS]
    if not views: views = ['beauty', 'top', 'side']

    legs = _leg_objs()
    base_mw = {o.name: o.matrix_world.copy() for o in legs}
    ctr = sum(coords, Vector()) / len(coords)
    groups = _leg_groups(legs, ctr) if legs else []
    print("LEGS", len(legs), "groups", len(groups), flush=True)

    cur = None
    for v in views:
        cam, transparent, path, theta = JOBS[v]
        if groups and theta != cur:
            _pose_legs(groups, base_mw, theta); cur = theta
        sc.camera = cam; sc.render.film_transparent = transparent; sc.render.filepath = path
        print("RENDERING", name, v, cam.name, "theta", round(math.degrees(theta), 1), "->", path, flush=True)
        bpy.ops.render.render(write_still=True)
    if groups and cur not in (None, 0.0): _pose_legs(groups, base_mw, 0.0)
    print("DONE", flush=True)
