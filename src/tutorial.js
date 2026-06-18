// Tutoriales guiados POR SECCIÓN usando el paquete compartido del ecosistema
// @dotrino/tutorial (burbujas tipo donar/compartir). En Critters
// no hay una sola "primera vez": cada vista (Campaña, Equipo, Colección, Fusión,
// Encuentro, Batalla, Detalle de criatura, Inicial) tiene su PROPIO tutorial corto
// e INDEPENDIENTE que aparece la PRIMERA VEZ que se entra a esa sección.
//
// Cómo se logra "una vez por sección":
//   · Cada sección es una instancia separada de createTutorial con su propio
//     storageKey → la librería persiste en localStorage "visto una sola vez" por
//     paso, sin que una sección pise a otra.
//   · La instancia se crea perezosamente (autostart:false) y se arranca desde la
//     app la primera vez que la vista se monta (ver App.vue → onView()).
//   · Volver a start() es idempotente: la librería salta los pasos ya vistos y, si
//     están todos vistos, termina sin mostrar nada.
//
// Las burbujas son: una a la vez, en orden, on-screen (la librería voltea/clampa),
// bilingües es/en (texto { es, en }; el idioma se reaplica en cada start()).
import { createTutorial } from '@dotrino/tutorial';
import { i18n } from './i18n.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tema acorde a la paleta del juego (tinta/violeta/cian) — variables del componente.
const THEME = {
  accent: '#1a1430',      // fondo de la burbuja (tinta profunda) y cursor
  text: '#ece9ff',
  radius: '14px',
  ring: 'rgba(167,139,250,.95)',
  ringGlow: 'rgba(167,139,250,.32)',
};
const STYLES = `
  .bubble{border:1px solid rgba(167,139,250,.45)}
  .title{color:#c7b3ff}
  .next{background:#7c5cff;color:#fff;border:none}
  .skip{color:#9b93c4}
`;

// Etiquetas de botones bilingües (next/skip/done) para el componente.
const I18N = {
  es: { next: 'Siguiente', skip: 'Saltar', done: 'Listo' },
  en: { next: 'Next', skip: 'Skip', done: 'Done' },
};

// Definición de pasos por sección. target usa data-testid estables ya presentes
// (o agregados) en los *View.vue. placement es solo preferencia: la librería lo
// voltea si no entra y hace clamp al viewport (nunca se sale de pantalla).
const SECTIONS = {
  // INICIAL — elegir la primera criatura (pantalla previa al juego).
  starter: {
    storageKey: 'critters.tut.starter',
    steps: [
      {
        id: 'st-pick', placement: 'bottom',
        target: '[data-testid="starter-grid"]',
        title: { es: 'Tu primera criatura', en: 'Your first critter' },
        text: {
          es: 'Toca Elegir para quedarte con una. Después ganas más peleando: capturas, monedas e invocaciones.',
          en: 'Tap Choose to keep one. You get more by fighting: captures, coins and summons.',
        },
      },
    ],
  },

  // CAMPAÑA — el mapa de niveles paneable.
  campana: {
    storageKey: 'critters.tut.campana',
    steps: [
      {
        id: 'cmp-map', placement: 'top',
        target: '[data-testid="campaign-map"]',
        title: { es: 'El mapa', en: 'The map' },
        text: {
          es: 'Arrastra para moverte y toca un nivel para ver el encuentro. Los nodos con candado se desbloquean ganando.',
          en: 'Drag to move and tap a level to see the encounter. Locked nodes open up as you win.',
        },
      },
      {
        id: 'cmp-ctrl', placement: 'left',
        target: '[data-testid="map-ctrl"]',
        title: { es: 'Acercar y centrar', en: 'Zoom and center' },
        text: {
          es: 'Acerca, aleja o centra el mapa. El banderín ⚑ te lleva a tu último enfrentamiento.',
          en: 'Zoom in/out or recenter. The ⚑ flag jumps to your last battle.',
        },
      },
      {
        id: 'cmp-team', placement: 'bottom',
        target: '[data-testid="tab-equipo"]',
        title: { es: 'Arma tu equipo', en: 'Build your team' },
        text: {
          es: 'Antes de pelear, coloca criaturas en Equipo. Sin equipo no puedes entrar a un nivel.',
          en: 'Before fighting, place critters in Team. Without a team you cannot enter a level.',
        },
      },
    ],
  },

  // EQUIPO — alineaciones 3×3 + banquillo.
  equipo: {
    storageKey: 'critters.tut.equipo',
    steps: [
      {
        id: 'tm-bench', placement: 'top',
        target: '[data-testid="team-bench"]',
        title: { es: 'El banquillo', en: 'The bench' },
        text: {
          es: 'Aquí están tus criaturas libres. Arrastra una hacia una casilla de la rejilla para alinearla.',
          en: 'Your free critters live here. Drag one onto a grid cell to field it.',
        },
      },
      {
        id: 'tm-grid', placement: 'top',
        target: '[data-testid="team-lineups"]',
        title: { es: 'La alineación 3×3', en: 'The 3×3 lineup' },
        text: {
          es: 'La columna derecha (▶) es el frente, hacia el rival. Toca una criatura para verla y configurarla.',
          en: 'The right column (▶) is the frontline, toward the enemy. Tap a critter to view and tune it.',
        },
      },
      {
        id: 'tm-new', placement: 'bottom',
        target: '[data-testid="team-new-lineup"]',
        title: { es: 'Varias alineaciones', en: 'Multiple lineups' },
        text: {
          es: 'Crea distintas alineaciones y marca con ★ la que usarás en la próxima batalla.',
          en: 'Create different lineups and mark with ★ the one you will take into battle.',
        },
      },
    ],
  },

  // COLECCIÓN — gacha (invocar) + parrilla de criaturas.
  coleccion: {
    storageKey: 'critters.tut.coleccion',
    steps: [
      {
        id: 'col-summon', placement: 'bottom',
        target: '[data-testid="summon-btn"]',
        title: { es: 'Invocar', en: 'Summon' },
        text: {
          es: 'Gasta monedas para invocar una criatura nueva (única por su semilla).',
          en: 'Spend coins to summon a brand-new critter (unique by its seed).',
        },
      },
      {
        id: 'col-grid', placement: 'top',
        target: '[data-testid="collection-grid"]',
        skipIf: () => !document.querySelector('[data-testid="collection-grid"] .ccard, [data-testid="collection-grid"] > *'),
        title: { es: 'Tu colección', en: 'Your collection' },
        text: {
          es: 'Todas tus criaturas viven aquí. Toca una para ver sus stats, elemento y habilidades.',
          en: 'All your critters live here. Tap one to see its stats, element and abilities.',
        },
      },
    ],
  },

  // FUSIÓN — combinar dos criaturas.
  fusion: {
    storageKey: 'critters.tut.fusion',
    steps: [
      {
        id: 'fus-intro', placement: 'bottom',
        target: '[data-testid="fusion-hint"]',
        title: { es: 'Fusionar', en: 'Fusion' },
        text: {
          es: 'Combina dos criaturas de la MISMA rareza: pueden evolucionar, reforzarse o devolucionar según se parezcan.',
          en: 'Combine two critters of the SAME rarity: they evolve, reinforce or devolve depending on how alike they are.',
        },
      },
      {
        id: 'fus-grid', placement: 'top',
        target: '[data-testid="fusion-grid"]',
        skipIf: () => !document.querySelector('[data-testid="fusion-grid"]'),
        title: { es: 'Elige dos', en: 'Pick two' },
        text: {
          es: 'Toca la primera criatura y luego la segunda (las incompatibles se atenúan). Confirma para fusionarlas.',
          en: 'Tap the first critter, then the second (incompatible ones dim out). Confirm to fuse them.',
        },
      },
    ],
  },

  // ENCUENTRO — modal previo a la batalla.
  encounter: {
    storageKey: 'critters.tut.encounter',
    steps: [
      {
        id: 'enc-lineup', placement: 'top',
        target: '[data-testid="enc-lineup"]',
        title: { es: 'Antes de pelear', en: 'Before you fight' },
        text: {
          es: 'Mira al rival y el terreno, y elige con qué alineación entras a este nivel.',
          en: 'Check the enemy and the terrain, and choose which lineup enters this level.',
        },
      },
      {
        id: 'enc-speed', placement: 'top',
        target: '[data-testid="enc-speed"]',
        title: { es: 'Velocidad', en: 'Speed' },
        text: {
          es: 'La batalla es automática y va rápido: ajusta la velocidad antes de pulsar Pelear.',
          en: 'The battle is automatic and fast: set the speed before tapping Fight.',
        },
      },
      {
        id: 'enc-fight', placement: 'top',
        target: '[data-testid="fight-btn"]',
        title: { es: '¡A pelear!', en: 'Fight!' },
        text: {
          es: 'Tus criaturas pelean solas según el rol y los objetivos que les configuraste.',
          en: 'Your critters fight on their own following the role and targets you set for them.',
        },
      },
    ],
  },

  // BATALLA — arena automática en curso.
  battle: {
    storageKey: 'critters.tut.battle',
    steps: [
      {
        id: 'bat-arena', placement: 'bottom',
        target: '[data-testid="battle-arena"]',
        title: { es: 'Batalla automática', en: 'Automatic battle' },
        text: {
          es: 'Es determinista: tus criaturas actúan según rol y objetivos. Tu trabajo fue prepararlas; ahora observa.',
          en: 'It is deterministic: your critters act by role and target. Your job was to prepare them; now watch.',
        },
      },
      {
        id: 'bat-speed', placement: 'top',
        target: '[data-testid="battle-speed"]',
        skipIf: () => !document.querySelector('[data-testid="battle-speed"]'),
        title: { es: 'Cambia el ritmo', en: 'Change the pace' },
        text: {
          es: 'Acelera o frena la simulación cuando quieras. Al terminar verás el resumen y las estrellas.',
          en: 'Speed it up or slow it down anytime. When it ends you see the summary and stars.',
        },
      },
    ],
  },

  // DETALLE — perfil/configuración de una criatura.
  detail: {
    storageKey: 'critters.tut.detail',
    steps: [
      {
        id: 'det-tabs', placement: 'bottom',
        target: '[data-testid="detail-tabs"]',
        title: { es: 'Perfil de la criatura', en: 'Critter profile' },
        text: {
          es: 'Recorre las pestañas: Stats (sube puntos), Elemento, Habilidades y Combate (rol y prioridad de objetivo).',
          en: 'Browse the tabs: Stats (spend points), Element, Abilities and Combat (role and target priority).',
        },
      },
      {
        id: 'det-feed', placement: 'top',
        target: '[data-testid="detail-feed"]',
        title: { es: 'Alimentar', en: 'Feed' },
        text: {
          es: 'Gasta fragmentos para darle XP y subir de nivel sin pelear.',
          en: 'Spend fragments to grant XP and level it up without fighting.',
        },
      },
    ],
  },
};

// Instancias perezosas (una por sección). Se crean al primer onView de la sección.
const instances = Object.create(null);
// Evita lanzar dos veces en la misma sesión (la persistencia ya evita repetir
// entre sesiones; esto solo ahorra trabajo si la vista se monta varias veces).
const started = Object.create(null);

function build (name) {
  const def = SECTIONS[name];
  if (!def) return null;
  const tour = createTutorial({
    autostart: false,                 // lo arranca la app cuando entra a la vista
    lang: i18n.lang === 'en' ? 'en' : 'es',
    storageKey: def.storageKey,
    i18n: I18N,
    theme: THEME,
    styles: STYLES,
    startDelay: 500,                  // deja respirar al montaje/animación de la vista
    stepTimeout: 4000,
    steps: def.steps,
  });
  return tour;
}

/**
 * Lanza el tutorial de una sección la primera vez que se entra a su vista.
 * Idempotente: si ya se vio (persistido) o ya se lanzó en esta sesión, no hace nada.
 * @param {string} name  starter|campana|equipo|coleccion|fusion|encounter|battle|detail
 */
export async function onView (name) {
  if (!SECTIONS[name]) return;
  if (started[name]) return;
  started[name] = true;
  let tour = instances[name];
  if (!tour) tour = instances[name] = build(name);
  if (!tour) return;
  // Reaplica el idioma actual (el usuario pudo cambiarlo) antes de arrancar.
  tour.setAttribute('lang', i18n.lang === 'en' ? 'en' : 'es');
  // Pequeña espera para que la vista termine de montar/animar y el target exista.
  await sleep(60);
  tour.start();
}

/** Reinicia la persistencia de TODOS los tutoriales (útil tras borrar datos). */
export function resetAllTutorials () {
  for (const name of Object.keys(SECTIONS)) {
    const def = SECTIONS[name];
    for (const s of def.steps) {
      try { localStorage.removeItem(`${def.storageKey}:seen:${s.id}`); } catch {}
    }
    started[name] = false;
    const t = instances[name];
    if (t && typeof t.reset === 'function') { try { t.reset(); } catch {} }
  }
}
