# Inspector: vuelca cámara, luces, materiales, transforms y modificadores de un .blend para
# poder PORTAR tus ediciones al código (critter3d.py).
# Uso:  blender --background <archivo.blend> --python dump_blend.py
import bpy, math, json

def col(c): return [round(v, 4) for v in (c[0], c[1], c[2])]
sc = bpy.context.scene
rep = {"render": {}, "objects": [], "materials": []}
try:
    rep["render"] = {"engine": sc.render.engine, "res": [sc.render.resolution_x, sc.render.resolution_y],
                     "samples": getattr(getattr(sc, "cycles", None), "samples", None)}
except Exception: pass

for ob in sc.objects:
    o = {"name": ob.name, "type": ob.type,
         "loc": [round(v, 4) for v in ob.location],
         "rot_deg": [round(math.degrees(v), 2) for v in ob.rotation_euler],
         "scale": [round(v, 4) for v in ob.scale],
         "mods": []}
    for m in ob.modifiers:
        md = {"name": m.name, "type": m.type}
        if m.type == 'SUBSURF': md.update(levels=m.levels, render_levels=m.render_levels)
        if m.type == 'BEVEL': md.update(width=round(m.width, 4), segments=m.segments)
        o["mods"].append(md)
    if ob.type == 'CAMERA': o["lens"] = round(ob.data.lens, 2)
    if ob.type == 'LIGHT':
        l = ob.data
        o["light"] = {"ltype": l.type, "energy": round(l.energy, 1), "size": round(getattr(l, "size", 0), 3), "color": col(l.color)}
    rep["objects"].append(o)

for m in bpy.data.materials:
    if not m.use_nodes: continue
    info = {"name": m.name}
    for n in m.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            info["base_color"] = col(n.inputs["Base Color"].default_value)
            for k in ("Metallic", "Roughness", "IOR"):
                if k in n.inputs: info[k.lower()] = round(n.inputs[k].default_value, 3)
            for k in ("Coat Weight", "Clearcoat", "Coat"):
                if k in n.inputs: info["coat"] = round(n.inputs[k].default_value, 3); break
            if "Emission Strength" in n.inputs: info["emission_strength"] = round(n.inputs["Emission Strength"].default_value, 3)
        if n.type == 'EMISSION':
            info["emission_color"] = col(n.inputs["Color"].default_value)
            info["emission_strength"] = round(n.inputs["Strength"].default_value, 3)
    rep["materials"].append(info)

print("=== BLEND DUMP ===")
print(json.dumps(rep, indent=2))
print("=== END DUMP ===")
