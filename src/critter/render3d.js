// Render 3D del critter como ICONO ANIMADO (marcha de 2 frames), bajo demanda desde el genoma.
// - frames en S3 (Cloudflare): https://s3.dotrino.com/critters/<sha256(id)[:32]>/<view>.webp
//   (top1/top2 = patas adelante/atrás intercaladas; ver tools/blender + tools/lambda).
// - si faltan (403), encola el render en https://render.dotrino.com/ y REINTENTA ~cada
//   minuto. Mientras tanto el icono muestra el SVG y la circunferencia gira (pending).
// - el icono alterna top1<->top2; la CADENCIA depende de la velocidad de batalla (speed).
import { ref, watch, onUnmounted } from 'vue';
import { speed } from '../speed.js';
import { critterById } from '../game/state.js';
import { genomeId } from './forge.js';

// Versión del render: bumpear (v2→v3…) cuando cambian los parámetros de Blender (swing,
// encuadre, estilo) para invalidar el caché inmutable sin huérfanos. Debe coincidir con
// el PREFIX de la Lambda (env PREFIX=critters/v2/).
const IMG_BASE = 'https://s3.dotrino.com/critters/v7';
const RES = 384, SAMPLES = 96;   // imágenes chicas (iconos 40-128px) → render rápido y liviano
const INTAKE = 'https://render.dotrino.com/';
const RETRY_MS = 12000;    // re-chequea si la imagen ya existe cada ~12s (el render tarda ~60-90s)
const STEP_MS = 360;       // ms por frame a speed 1 (la cadencia escala con speed)

async function keyOf (id) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// Genoma CANÓNICO de una instancia (misma apariencia que el SVG): para que TODA hormiga
// pueda renderizar, no solo las de fusión (g:...). El seed va saneado al formato del genoma.
export function genomeOf (inst) {
  const id = inst && inst.id;
  if (!id) return '';
  if (String(id).startsWith('g:')) return id;
  const c = critterById(id);
  const seed = String(id).replace(/[^A-Za-z0-9._+-]/g, '').slice(0, 24) || 'x';
  return genomeId({ ...c, seed });
}

const queued = new Set();   // no reencolar el mismo id dentro de la sesión
let reqseq = 0;             // contador para el cache-buster del intake
function requestRender (id, views) {
  const k = id + ':' + views.join(',');
  if (queued.has(k)) return;
  queued.add(k);
  // si el POST falla o lo throttlean (no-2xx), liberamos la clave para reintentar luego
  // query única → evita que Cloudflare sirva un POST cacheado (p.ej. un 500 transitorio).
  fetch(INTAKE + '?q=' + (++reqseq), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, views, res: RES, samples: SAMPLES }),
  }).then(r => { if (!r.ok) queued.delete(k); }).catch(() => queued.delete(k));
}

const preload = (u) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(u); im.onerror = rej; im.src = u; });

// Icono animado: alterna `views` (por defecto los 2 frames top) a una cadencia ~STEP_MS/speed.
// Devuelve { src, ready, pending }: <img v-show="ready" :src="src">; gira mientras pending && !ready.
// animate=false: precarga TODOS los frames (los deja cacheados para la animación de la
// batalla) pero muestra solo el 1º fijo (círculos). animate=true: alterna los frames.
export function use3dRender (idGetter, { views = ['top1', 'top2'], animate: doAnimate = true } = {}) {
  const src = ref('');
  const ready = ref(false);
  const pending = ref(false);
  let curId = '', urls = [], frame = 0, timer = null, attempt = 0;

  const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };

  function animate () {
    stop();
    // PING-PONG: con 3 frames [+, 0, -] la secuencia es 0,1,2,1 (de +x/2 a -x/2 pasando por
    // el centro y volviendo); con 2 frames es 0,1. La cadencia escala con la velocidad.
    const order = urls.length >= 3 ? [...urls.keys(), ...Array.from({ length: urls.length - 2 }, (_, i) => urls.length - 2 - i)]
                                   : urls.map((_, i) => i);
    let p = 0; src.value = urls[order[0]];
    const loop = () => {
      p = (p + 1) % order.length; src.value = urls[order[p]];
      timer = setTimeout(loop, Math.max(60, STEP_MS / (speed.value || 1)));
    };
    if (order.length > 1) timer = setTimeout(loop, Math.max(60, STEP_MS / (speed.value || 1)));
  }

  async function begin (id, first) {
    stop(); ready.value = false; pending.value = false; src.value = '';
    if (first) { curId = id || ''; attempt = 0; }
    if (!id || !String(id).startsWith('g:')) return;
    const key = await keyOf(id);
    if (curId !== id) return;
    // cache-buster en reintentos: si Cloudflare cacheó el 403 del miss, sin esto nunca
    // veríamos el 200 aunque el render ya exista.
    const q = attempt ? `?r=${attempt}` : '';
    urls = views.map(v => `${IMG_BASE}/${key}/${v}.webp${q}`);
    pending.value = true;
    Promise.all(urls.map(preload)).then(() => {           // todos los frames listos
      if (curId !== id) return;
      ready.value = true; pending.value = false;
      if (doAnimate) animate(); else src.value = urls[0];   // anima, o muestra el 1º fijo
    }).catch(() => {                                       // falta alguno → encolar + reintentar
      if (curId !== id) return;
      requestRender(curId, views);
      pending.value = true; attempt++;
      timer = setTimeout(() => begin(id), RETRY_MS);
    });
  }

  watch(idGetter, (id) => begin(id, true), { immediate: true });
  onUnmounted(stop);
  return { src, ready, pending };
}
