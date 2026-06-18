# QUIMERA: construye un critter MEZCLANDO partes de los 4 estilos (cabeza zoids, torax panzer,
# patas gundam, ...) de forma DETERMINISTA por genoma: cada parte elige estilo con un hash del
# id + nombre de parte. Los estilos exponen sus partes via el global CHIMERA_PARTS (ver contrato
# en cada critter3d_<estilo>.py); los materiales con el mismo nombre se COMPARTEN entre estilos
# (el primero que lo crea gana), lo que unifica la paleta de la quimera.
# La escena (luces + mundo + bloom + camaras multi-vista) viene SIEMPRE del estilo "mecha".
# Uso:  blender --background --python critter3d_chimera.py -- <spec.json> <out.png> [samples] [res] [forzar]
#   [forzar] opcional para probar: "head=zoids,thorax=panzer,legs=gundam,abdomen=mecha,antennae=zoids"
import bpy, json, sys, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
spec_path = argv[0] if len(argv) > 0 else "/tmp/critter_spec.json"
spec = json.load(open(spec_path))

def h32(s):
    h = 5381
    for ch in str(s): h = ((h * 33) ^ ord(ch)) & 0xffffffff
    return h


def hpick(s, n):
    # mezcla final (los bits bajos de djb2-xor con mult 33 son debiles: 33 == 1 mod 32,
    # asi que h %% n solo veria un XOR de bits bajos -> colisiones sistematicas)
    h = h32(s)
    h ^= h >> 16; h = (h * 0x45d9f3b) & 0xffffffff; h ^= h >> 16
    return h % n

HERE = os.path.dirname(os.path.abspath(__file__))
STYLES = ["mecha", "gundam", "zoids", "panzer"]
PART_NAMES = ("head", "thorax", "abdomen", "legs", "antennae")
gid = spec.get("id", "critter")
assign = {p: STYLES[hpick(gid + ":" + p, 4)] for p in PART_NAMES}
if len(argv) > 4 and "=" in argv[4]:   # override manual para pruebas
    for kv in argv[4].split(","):
        k, v = kv.split("="); assign[k.strip()] = v.strip()
print("CHIMERA", spec.get("name"), json.dumps(assign), flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)

def run_style(style, parts):
    path = os.path.join(HERE, "critter3d_%s.py" % style)
    g = {"__name__": "chimera", "__file__": path, "CHIMERA_PARTS": ",".join(parts)}
    exec(compile(open(path).read(), path, 'exec'), g)

by_style = {}
for p, st in assign.items(): by_style.setdefault(st, []).append(p)
for st in STYLES:                       # orden FIJO -> materiales compartidos deterministas
    if st in by_style: run_style(st, by_style[st])
run_style("mecha", ["scene"])           # luces + mundo + bloom + render multi-vista
