# Runner LOCAL: rinde critters con el Blender del PC (GPU, ~5 s) y sube a S3.
# Es el "camino primario barato" del README: la Lambda en contenedor es el fallback
# elástico, pero la clave `fable` no tiene permisos de ECR/IAM, así que el deploy
# real hoy es ESTE: render local + upload con las credenciales de .env.
#
#   ./.venv/bin/python render_upload.py g:demo:fuego:dps:2:0:0:6:1:1:0:1 [g:...]
#   FORCE=1 VIEWS=top SAMPLES=96 RES=1024 ./.venv/bin/python render_upload.py <preset|id>
#
# Env (o .env de la raíz del repo, que se carga solo): AWS_*, BUCKET, PREFIX,
# VIEWS (coma), SAMPLES, RES, FORMATS (coma), FORCE, DRY_RUN.
import os, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent  # .../critters

# cargar .env de la raíz del repo si existe (no pisa lo ya exportado)
envf = REPO / ".env"
if envf.exists():
    for line in envf.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

# apuntar el handler al Blender y a los scripts LOCALES del repo
os.environ.setdefault("BLENDER", "/usr/bin/blender")
os.environ.setdefault("SCRIPTS_DIR", str(REPO / "tools" / "blender"))
# El Blender de distro suele venir SIN OpenImageDenoiser; por defecto lo dejamos
# apagado en local (subí los samples). Exportá CRITTER_DENOISE=1 sólo si tu build
# oficial trae OIDN. La imagen Lambda sí lo trae (lo fija su Dockerfile).
os.environ.setdefault("CRITTER_DENOISE", "")

sys.path.insert(0, str(HERE))
import handler  # noqa: E402

def main(argv):
    ids = argv or ["g:demo:fuego:dps:2:0:0:6:1:1:0:1"]
    views = [v for v in os.environ.get("VIEWS", "").split(",") if v] or None
    formats = [f for f in os.environ.get("FORMATS", "").split(",") if f] or None
    event_base = {
        "views": views,
        "formats": formats,
        "force": bool(os.environ.get("FORCE")),
    }
    if os.environ.get("SAMPLES"):
        event_base["samples"] = int(os.environ["SAMPLES"])
    if os.environ.get("RES"):
        event_base["res"] = int(os.environ["RES"])
    rc = 0
    for gid in ids:
        ev = dict(event_base, id=gid)
        try:
            res = handler.lambda_handler(ev)
            print(gid, "->", res)
        except Exception as e:  # noqa: BLE001
            rc = 1
            print(gid, "FALLO:", e, file=sys.stderr)
    return rc

if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
