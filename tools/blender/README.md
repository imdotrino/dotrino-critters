# Critters → 3D (Blender)

Pipeline procedural: construye el modelo 3D de un critter **desde su genoma** (misma anatomía
que `src/critter/svg.js`) y lo renderiza. Útil para arte de cartas, promo o assets (GLB).
Estilo **super mecha** con cuatro líneas de diseño puras **+ quimeras** que mezclan partes,
todo elegido DETERMINISTA por genoma (hash mezclado del `id`; `critter3d.py` despacha:
50 % quimera, 12.5 % cada estilo puro):

| estilo | script | look |
|---|---|---|
| `mecha` | `critter3d_mecha.py` | anatomía de hormiga + bandas facetadas, tri-tono, luces |
| `gundam` | `critter3d_gundam.py` | frame interno gunmetal + placas Master Grade |
| `zoids` | `critter3d_zoids.py` | caparazón segmentado insecto-mech, servos y pistones |
| `panzer` | `critter3d_panzer.py` | blindaje pesado tipo tanque + neón under-glow |
| `chimera` | `critter3d_chimera.py` | mezcla por parte: cabeza/tórax/abdomen/patas/antenas, cada una de un estilo (hash por parte); paleta unificada y escena de `mecha` |

Cada estilo corre standalone con la misma CLI y expone sus partes vía el global
`CHIMERA_PARTS` / env `CRITTER_PARTS` (`reset,head,thorax,abdomen,legs,antennae,scene`).
La quimera acepta un 5º arg para forzar partes: `"head=zoids,thorax=panzer,legs=gundam"`.
Las filas de anclaje de patas se adaptan a las masas existentes (una cabeza sola con 6
patas las abre en abanico, sin patas flotando). Todo simétrico y determinista por genoma
(sin kitbash aleatorio); los colores salen del elemento del spec.

**Cámaras** (`critter3d_cams.py`, compartidas): encuadre AUTOMÁTICO al bounding box
(nunca se corta la criatura; con menos partes sale centrada) y 3 vistas por render:
`<out>.png` (beauty 3/4), **`<out>_top.png` (vista superior ortográfica, cabeza hacia
arriba, fondo transparente — la vista del juego)** y `<out>_side.png` (perfil). El
`.blend` guarda las 3 cámaras (activa: beauty).

## Uso
1) Sacar el spec del critter desde el juego:
   `node tools/blender/critter_spec.mjs <preset|g:...id> tools/blender/spec.json`
   presets: `fire_full · water · plant · min · nolegs`
2) Construir + renderizar (y guardar el .blend editable):
   `blender --background --python tools/blender/critter3d.py -- tools/blender/spec.json tools/blender/out.png [samples] [res]`
   (`samples`/`res` opcionales, default 320/1024; usar p. ej. `96 640` para iterar rápido)

## Editar en GUI y volver a código
- Abrí el `.blend` (mismo nombre que el PNG), tocá cámara/luces/materiales/modificadores y guardá.
- Para portar tus cambios al código, se inspecciona headless:
  `blender --background tools/blender/critter3d_fire.blend --python tools/blender/dump_blend.py`
  (vuelca cámara, luces, materiales, transforms y modificadores en JSON).

## Render bajo demanda (Lambda → S3)

Para servir imágenes al juego sin pre-generar millones: **[`../lambda/`](../lambda/)**
(contenedor Blender CPU + handler que deriva el spec del genoma-id en Python y sube
webp inmutables a `s3://s3.dotrino.com/critters/<hash>/`).

## Archivos
- `critter_spec.mjs` — vuelca el spec (apariencia + colores) del critter.
- `critter3d.py` — construye la malla 3D y renderiza (Cycles GPU, fondo negro).
- `dump_blend.py` — inspector para leer ediciones del .blend.
