# Construye un CRITTER en 3D desde su spec (apariencia + colores del juego) y lo renderiza.
# DESPACHADOR de estilo: el genoma decide la linea de diseno super-mecha, DETERMINISTA
# (hash djb2 del id + ":style"). Pool: 4 estilos puros + quimeras que mezclan partes:
#   mecha   critter3d_mecha.py   fusion: anatomia de hormiga + tri-tono + luces
#   gundam  critter3d_gundam.py  frame interno gunmetal + placas Master Grade
#   zoids   critter3d_zoids.py   caparazon segmentado insecto-mech, servos y pistones
#   panzer  critter3d_panzer.py  blindaje pesado tipo tanque + neon under-glow
#   chimera critter3d_chimera.py mezcla por parte (cabeza/torax/abdomen/patas/antenas)
# Reparto: h % 8 -> 0..3 estilo puro, 4..7 quimera (50%). Cada estilo corre standalone igual.
# Uso:  blender --background --python critter3d.py -- <spec.json> <out.png> [samples] [res]
import json, sys, os

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

PURE = ["mecha", "gundam", "zoids", "panzer"]
r = hpick(spec.get("id", "critter") + ":style", 8)
style = PURE[r] if r < 4 else "chimera"
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "critter3d_%s.py" % style)
print("STYLE", style, "->", path, flush=True)
exec(compile(open(path).read(), path, 'exec'), {"__name__": "__main__", "__file__": path})
