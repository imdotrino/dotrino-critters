# Lambda de render de critters: genoma-id -> Blender (CPU, estilo por genoma) -> S3.
# Evento (invoke directo o Function URL con body JSON):
#   { "id": "g:...",            // genoma; o "spec": {...} ya derivado
#     "views": ["top"],          // subconjunto de ["top","beauty","side"]; default los 3
#     "samples": 160, "res": 1024,
#     "formats": ["webp"],       // y/o "png"
#     "force": false }           // true = re-renderiza aunque ya exista en S3
# Respuesta: { id, key, style, uploaded: [s3 keys], seconds }
# Env: BUCKET (s3.dotrino.com), PREFIX (critters/), BLENDER, SCRIPTS_DIR,
#      CRITTER_DENOISE=1 (OIDN del build oficial: menos samples, misma calidad),
#      DRY_RUN=1 (no sube a S3; para pruebas locales con RIE).
import base64, hashlib, json, os, re, shutil, subprocess, time
from pathlib import Path

import spec_derive

BLENDER = os.environ.get("BLENDER", "/opt/blender/blender")
SCRIPTS = os.environ.get("SCRIPTS_DIR", os.path.join(os.environ.get("LAMBDA_TASK_ROOT", "/var/task"), "blender"))
BUCKET = os.environ.get("BUCKET", "s3.dotrino.com")
PREFIX = os.environ.get("PREFIX", "critters/")
DRY_RUN = bool(os.environ.get("DRY_RUN"))
# Vistas: base + frames de animación de patas (top1/top2 y beauty1/beauty2).
VIEW_FILES = {"beauty": "r.png", "top": "r_top.png", "side": "r_side.png",
              "top1": "r_top1.png", "top2": "r_top2.png",
              "beauty1": "r_b1.png", "beauty2": "r_b2.png"}

def _s3():
    import boto3
    return boto3.client("s3")

# La Function URL es PÚBLICA: cualquiera puede postear. Para que no se pueda usar de
# cost-bomb (renders de basura), sólo aceptamos ids con FORMA de genoma real y acotamos
# los parámetros caros (samples/res/vistas). La idempotencia (HEAD a S3) hace el resto:
# pedir mil veces el mismo id no re-renderiza.
_GENOME_RE = re.compile(r"^g(:[A-Za-z0-9._+\-]{0,24}){4,11}$")

def _valid_genome(gid):
    return isinstance(gid, str) and len(gid) <= 160 and bool(_GENOME_RE.match(gid))

def lambda_handler(event, context=None):
    """Router: invoke directo, Function URL, o batch de SQS.
    - SQS: event = {"Records":[{"body": "<json>", ...}, ...]} → procesa cada uno;
      una excepción en un record no tira el batch entero (lo deja para reintento).
    - Function URL: event tiene body string (JSON) → un render.
    - Invoke directo: event ya es el dict de pedido.
    """
    if isinstance(event, dict) and isinstance(event.get("Records"), list):   # SQS
        results = []
        for rec in event["Records"]:
            try:
                payload = json.loads(rec.get("body") or "{}")
                results.append(_render(payload, public=True))
            except Exception as e:   # noqa: BLE001 — un id malo no debe frenar el resto
                results.append({"error": str(e), "messageId": rec.get("messageId")})
        return {"batch": results}
    # Function URL (body string) = público; invoke directo = confiable
    is_url = isinstance(event, dict) and isinstance(event.get("body"), str)
    return _render(event, public=is_url)

def _render(event, public=False):
    if isinstance(event, dict) and isinstance(event.get("body"), str):   # Function URL
        body = event["body"]
        if event.get("isBase64Encoded"): body = base64.b64decode(body).decode()
        event = json.loads(body or "{}")
    gid = event.get("id")
    if not _valid_genome(gid):                       # rechazo barato ANTES de tocar Blender
        raise ValueError("genome id invalido: %r" % gid)
    # desde la URL pública no se aceptan specs arbitrarios ni overrides caros
    spec = (event.get("spec") if not public else None) or spec_derive.spec_from_id(gid)
    gid = gid or spec["id"]
    views = [v for v in (event.get("views") or list(VIEW_FILES)) if v in VIEW_FILES]
    formats = [f for f in (event.get("formats") or ["webp"]) if f in ("webp", "png")]
    samples = max(16, min(int(event.get("samples", 160)), 320))
    res = max(128, min(int(event.get("res", 1024)), 1024))
    key_id = hashlib.sha256(gid.encode()).hexdigest()[:32]

    s3 = None if DRY_RUN else _s3()
    if s3 and not event.get("force"):
        try:   # idempotente: si la primera vista pedida ya existe, no re-renderizar
            probe = "%s%s/%s.%s" % (PREFIX, key_id, views[0], formats[0])
            s3.head_object(Bucket=BUCKET, Key=probe)
            return {"id": gid, "key": key_id, "cached": True, "uploaded": []}
        except Exception:
            pass

    out = Path("/tmp/render"); shutil.rmtree(out, ignore_errors=True); out.mkdir(parents=True)
    spec_path = out / "spec.json"
    spec_path.write_text(json.dumps(spec))
    t0 = time.time()
    cmd = [BLENDER, "--background", "--python", os.path.join(SCRIPTS, "critter3d.py"),
           "--", str(spec_path), str(out / "r.png"), str(samples), str(res)]
    # CRITTER_VIEWS: rinde SOLO las vistas pedidas (los frames de animación son caros).
    env = dict(os.environ, CRITTER_VIEWS=",".join(views))
    run = subprocess.run(cmd, capture_output=True, text=True, timeout=840, env=env)
    # éxito = existe el archivo de la PRIMERA vista pedida (con CRITTER_VIEWS la base
    # r.png puede no generarse; verificar r.png daría falso negativo).
    if run.returncode != 0 or not (out / VIEW_FILES[views[0]]).exists():
        raise RuntimeError("blender fallo (%d): %s" % (run.returncode, run.stdout[-1500:] + run.stderr[-500:]))
    m = re.search(r"^STYLE (\w+)", run.stdout, re.M)
    style = m.group(1) if m else "?"

    uploaded = []
    for view in views:
        src = out / VIEW_FILES[view]
        if not src.exists():
            raise RuntimeError("falta la vista %s (%s)" % (view, src))
        for fmt in formats:
            if fmt == "png":
                body, ctype = src.read_bytes(), "image/png"
            else:
                from PIL import Image
                im = Image.open(src)   # top viene RGBA (fondo transparente): webp lo conserva
                buf = out / (view + ".webp")
                im.save(buf, "WEBP", quality=88, method=4)
                body, ctype = buf.read_bytes(), "image/webp"
            key = "%s%s/%s.%s" % (PREFIX, key_id, view, fmt)
            if s3:
                s3.put_object(Bucket=BUCKET, Key=key, Body=body, ContentType=ctype,
                              CacheControl="public, max-age=31536000, immutable")
            else:
                (out / ("up_%s.%s" % (view, fmt))).write_bytes(body)
            uploaded.append({"key": key, "bytes": len(body)})
    return {"id": gid, "key": key_id, "style": style, "uploaded": uploaded,
            "seconds": round(time.time() - t0, 1)}
