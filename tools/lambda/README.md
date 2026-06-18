# Critters → render en Lambda → S3 (`s3.dotrino.com`)

Renderiza el 3D de un critter **bajo demanda** desde su genoma-id y deja las imágenes en S3.
Las imágenes son **caché regenerable** (el render es determinista): URLs inmutables,
`Cache-Control: immutable`, y si algo se pierde se vuelve a renderizar idéntico.

- `spec_derive.py` — port a Python de genoma-id → spec (idéntico al pipeline JS;
  validado 200/200 contra `forge.js`/`types.js` con `test_spec_derive.{mjs,py}`).
- `handler.py` — evento `{id|spec, views, samples, res, formats, force}` → corre el
  generador (`tools/blender/critter3d.py`, estilo por genoma) → sube webp/png a S3.
  Idempotente (HEAD antes de renderizar), `DRY_RUN=1` para pruebas sin S3.
- `Dockerfile` — base Lambda Python 3.12 + Blender 4.0.2 oficial (Cycles CPU + OIDN).

## Layout en S3

```
s3://s3.dotrino.com/critters/<sha256(genomeId)[:32]>/top.webp     ← la vista del juego
                                                      /beauty.webp
                                                      /side.webp
```

El juego calcula la key con `sha256(id)` y pide la URL; si 404/403 → muestra el SVG
y pide el render (la mejora llega sola en la siguiente carga).

## Disparo on-demand (DESPLEGADO): API Gateway → SQS → Lambda → S3

La invocación pública directa de la Lambda (Function URL `auth NONE`) está **bloqueada por
un guardrail/SCP de la organización** (da 403). La salida serverless y sin VPS es exponer
una API Gateway que sólo encola en SQS; SQS dispara la Lambda. El navegador no toca AWS.

```
navegador (miss) ──POST {id}──▶ API Gateway ──SendMessage──▶ SQS FIFO ──▶ Lambda ──▶ S3
```

- **Endpoint:** `POST https://render.dotrino.com/` (Cloudflare Worker que reenvía a la
  API Gateway `naxyvfx1db.execute-api.us-east-1.amazonaws.com/prod/render`). Body
  `{"id":"g:...","views":["top"]}` → `{"queued":true}`. Throttling 5 req/s (burst 10),
  CORS abierto, validación de genoma en la puerta (400 si es basura).
- **Validación en la puerta:** un request-validator + modelo JSON-Schema (`GenomeReq`,
  con `pattern` de genoma y rangos de samples/res) rechaza la basura con **400 ANTES de
  encolar** — no gasta SQS ni Lambda. (SQS no puede validar contenido; API Gateway sí.)
  La validación de la Lambda queda como defensa en profundidad.
- **Cola** `critters-render` (estándar) + event source mapping con `MaximumConcurrency=10`
  → hasta 10 renders en paralelo (SQS escala la función sola; sin patrón madre/hijas). La
  Lambda es idempotente (HEAD a S3), así que ids repetidos salen baratos (cached). Valida
  el formato de genoma antes de Blender.
- **Caché versionado:** las imágenes viven en `critters/v2/<hash>/<view>.webp` (env Lambda
  `PREFIX`); bumpear la versión al cambiar params de Blender invalida sin huérfanos.

Lado del juego (detectar miss → encolar; la imagen llega sola en la próxima carga):

```js
const KEY = (id) => sha256Hex(id).slice(0, 32);   // sha256 → primeros 32 hex
const IMG = (id) => `https://s3.dotrino.com/critters/${KEY(id)}/top.webp`;
const INTAKE = "https://render.dotrino.com/";   // Worker → API Gateway → SQS

async function critterImg(id) {
  const r = await fetch(IMG(id), { method: "GET" });
  if (r.ok) return IMG(id);                         // 200 → cacheada, listo
  fetch(INTAKE, { method: "POST", headers: { "content-type": "application/json" },
                  body: JSON.stringify({ id, views: ["top"] }) });  // 403 → encolar (fire-and-forget)
  return null;                                       // mostrar el SVG mientras tanto
}
```

## Build y prueba local (sin AWS)

```bash
docker build -f tools/lambda/Dockerfile -t critters-render .     # desde la RAÍZ del repo
docker run --rm -p 9000:8080 -e DRY_RUN=1 critters-render
curl -s http://localhost:9000/2015-03-31/functions/function/invocations \
     -d '{"id":"g:demo:fuego:dps:2:0:0:6:1:1:0:1","views":["top"],"samples":64,"res":512}'
```

## Deploy ACTIVO hoy: render local (GPU) → S3 (`render_upload.py`)

La clave AWS disponible (`.env`, usuario `fable`) **sólo tiene S3** (puede crear
bucket y `PutObject`/`GetObject`); **no** tiene ECR ni IAM, así que la Lambda en
contenedor (más abajo) **no se puede desplegar con esta clave**. El camino vivo es
el primario del README: render con el Blender local y subida directa a S3.

```bash
cd tools/lambda
python3 -m venv .venv && ./.venv/bin/pip install boto3 pillow
# usa las credenciales de ../../.env automáticamente; bucket s3.dotrino.com
VIEWS=top SAMPLES=96 RES=512 ./.venv/bin/python render_upload.py \
    g:demo:fuego:dps:2:0:0:6:1:1:0:1
# varios ids de una; FORCE=1 re-renderiza; DRY_RUN=1 no sube (deja up_*.webp en /tmp/render)
```

Sube a `s3://s3.dotrino.com/critters/<sha256(id)[:32]>/<view>.webp`, idempotente
(HEAD antes de renderizar). El Blender de distro suele venir **sin** OIDN: el runner
deja `CRITTER_DENOISE` apagado por defecto (subí `SAMPLES`); exportá `CRITTER_DENOISE=1`
sólo con un build oficial que traiga el denoiser.

> Falta para servir al juego: el bucket **no** tiene aún policy de lectura pública
> ni CORS en `critters/*` (cambio de exposición pública: requiere visto bueno
> explícito). Hasta entonces los objetos están subidos pero no son legibles anónimos.

## Despliegue del contenedor (YA DESPLEGADO)

Función `critters-render` en `us-east-1`: imagen 2.14 GB en ECR, 10 GB RAM,
/tmp 2 GB, timeout 900 s, rol `LambdaS3ExecutionRole`. La clave `fable` tiene S3 + ECR
(push + lifecycle); el rol de ejecución es uno existente (no se crean roles IAM).

```bash
ACC=147464502454; REGION=us-east-1; REPO=$ACC.dkr.ecr.$REGION.amazonaws.com/critters-render
# build desde la RAIZ del repo
docker build -f tools/lambda/Dockerfile -t critters-render .
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACC.dkr.ecr.$REGION.amazonaws.com
docker tag critters-render:latest $REPO:latest && docker push $REPO:latest

# primera vez: create-function (ya hecho). Re-deploy de código nuevo:
aws lambda update-function-code --function-name critters-render --region $REGION --image-uri $REPO:latest
```

`create-function` original (referencia): `--package-type Image --code ImageUri=$REPO:latest
--role arn:aws:iam::$ACC:role/LambdaS3ExecutionRole --memory-size 10240 --timeout 900
--ephemeral-storage Size=2048`. El repo tiene policy que deja a `lambda.amazonaws.com`
leer la imagen, y lifecycle que expira imágenes untagged > 7 días.

Lectura pública del bucket (solo el prefijo de imágenes) — PENDIENTE de aplicar:

```json
{ "Version": "2012-10-17", "Statement": [{
    "Effect": "Allow", "Principal": "*", "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::s3.dotrino.com/critters/*" }] }
```

Invocar (awscli v1 → payload por archivo, sin `--cli-binary-format`):

```bash
printf '%s' '{"id":"g:demo:fuego:dps:2:0:0:6:1:1:0:1","views":["top"]}' > /tmp/p.json
aws lambda invoke --function-name critters-render --region us-east-1 \
  --payload file:///tmp/p.json /tmp/out.json && cat /tmp/out.json
```

## Parámetros recomendados

Medido en el contenedor real limitado a 6 CPUs (`docker run --cpus=6`, equivalente a
Lambda con 10 GB), con OIDN activo:

| uso | evento | tiempo medido | costo aprox |
|---|---|---|---|
| juego, top ligera | `{"views":["top"],"samples":64,"res":512}` | ~12 s | ~$0.002 |
| juego, top HD | `{"views":["top"],"samples":96,"res":1024}` | ~58 s | ~$0.010 |
| carta completa (3 vistas) | `{"samples":128,"res":1024}` | ~2-3 min | ~$0.02-0.03 |

`CRITTER_DENOISE=1` (ya en la imagen) activa OIDN: la mitad de samples con la misma
calidad. Memoria 10240 MB = 6 vCPU (Cycles escala con los núcleos; menos memoria =
más lento y apenas más barato). La GPU local (RTX 4060 Ti, ~5 s) sigue siendo el
camino primario barato; la Lambda es el **fallback elástico** cuando el PC está apagado.

## Privacidad

La Lambda solo ve genoma-ids sueltos (sin IPs de jugadores) si quien la invoca es el
servicio de cola del VPS. No loguear ids junto a datos de cliente. El bucket sirve
imágenes estáticas inmutables; no requiere cookies ni JS de terceros.
