// Catalogue data ported from EZPackshot (https://github.com/Grohle/EZPackshot, GPL-3.0) by its author for Repackshot (PolyForm Noncommercial 1.0.0); values are data, the implementation is new.

import type { DoctorCheck } from './types';

// Scene doctor checks (upstream CHECKS, 14 entries in upstream order, then the
// ones of Repackshot's own phases: `aspect`, U13; `physics`, S2; `particles`, S4a).
// These are descriptors only: what each check looks at and what its one-click fix
// does. The logic that runs them lives with the scene code, not here.
export const DOCTOR_CHECKS: readonly DoctorCheck[] = [
  {
    key: 'engine',
    label: { es: 'Motor y GPU', en: 'Engine and GPU' },
    checks: {
      es: 'El motor de render es Cycles y su dispositivo (CPU o GPU) coincide con lo que pide el ajuste de dispositivo; quien elige CPU a proposito no ve aviso.',
      en: 'The render engine is Cycles and its compute device (CPU or GPU) matches what the device setting asks for; someone who picked CPU on purpose sees no warning.',
    },
    fix: {
      es: 'Vuelve a aplicar el dispositivo de render a la escena.',
      en: 'Reapplies the render device setting to the scene.',
    },
  },
  {
    key: 'lighttree',
    label: { es: 'Light tree', en: 'Light tree' },
    checks: {
      es: 'Hay materiales emisores y el light tree esta apagado, lo que mete mucho ruido.',
      en: 'The scene has emissive materials but the light tree is off, which adds a lot of noise.',
    },
    fix: {
      es: 'Enciende el light tree.',
      en: 'Turns the light tree on.',
    },
  },
  {
    key: 'denoise',
    label: { es: 'Denoise', en: 'Denoising' },
    checks: {
      es: 'El ajuste de denoise esta activo pero el denoise esta apagado en el render o en la vista previa, asi que habra ruido; si el usuario lo apago a proposito no hay aviso.',
      en: 'The denoise setting is on but denoising is off for the render or for the preview, so expect noise; nothing is reported if the user turned it off on purpose.',
    },
    fix: {
      es: 'Activa el ajuste de denoise y vuelve a aplicar los ajustes de render.',
      en: 'Turns the denoise setting on and reapplies the render settings.',
    },
  },
  {
    key: 'color',
    label: { es: 'Tono', en: 'View transform' },
    checks: {
      es: 'La transformacion de vista de la escena no coincide con la elegida en los ajustes.',
      en: "The scene's view transform does not match the one chosen in the settings.",
    },
    fix: {
      es: 'Vuelve a aplicar la transformacion de vista elegida y pone el gamma a 1.0.',
      en: 'Reapplies the chosen view transform and resets gamma to 1.0.',
    },
  },
  {
    key: 'scale',
    label: { es: 'Escala de la pieza', en: 'Model scale' },
    checks: {
      es: 'El tamano de la pieza es mas de 20 veces mayor, o mas de 20 veces menor, que el tamano declarado.',
      en: 'The size of the model is more than 20 times larger, or more than 20 times smaller, than the declared size.',
    },
    fix: {
      es: 'Reescala la pieza para que su tamano sea el declarado.',
      en: 'Rescales the model so its size equals the declared size.',
    },
  },
  {
    key: 'transform',
    label: { es: 'Escala aplicada', en: 'Applied scale' },
    checks: {
      es: 'Alguna malla tiene una escala sin aplicar (se aparta de 1 mas de 0.01 en algun eje), lo que deforma los biseles.',
      en: 'A mesh has an unapplied scale (off 1 by more than 0.01 on some axis), which distorts the bevels.',
    },
    fix: {
      es: 'Hornea la escala en la malla y la deja en 1, saltandose las mallas con datos compartidos.',
      en: 'Bakes the scale into the mesh and resets it to 1, skipping meshes whose data is shared.',
    },
  },
  {
    key: 'origin',
    label: { es: 'Origen de la pieza', en: 'Model origin' },
    checks: {
      es: 'El origen de la pieza esta a mas del 40% de su radio de la caja envolvente respecto al centro de esta, asi que el giro saldra descentrado.',
      en: 'The origin of the model is farther than 40% of its bounding radius from the centre of its bounds, so a spin comes out off-centre.',
    },
    fix: {
      es: 'Mueve el origen al centro de la caja envolvente, saltandose las mallas con datos compartidos.',
      en: 'Moves the origin to the centre of the bounding box, skipping meshes whose data is shared.',
    },
  },
  {
    key: 'shading',
    label: { es: 'Suavizado', en: 'Smoothing' },
    checks: {
      es: 'Una malla de mas de 200 caras no tiene ninguna cara suavizada, asi que las curvas se ven facetadas.',
      en: 'A mesh with more than 200 faces has no smooth-shaded face, so curves look faceted.',
    },
    fix: {
      es: 'Suaviza todas las caras, marca aristas vivas a partir de 35 grados y anade un modificador de normales ponderadas si falta.',
      en: 'Smooths every face, marks edges sharp from a 35 degree angle and adds a weighted-normal modifier if missing.',
    },
  },
  {
    key: 'bevel',
    label: { es: 'Bisel de aristas', en: 'Edge bevel' },
    checks: {
      es: 'Algun material gestionado que no es emisor no lleva bisel, asi que las aristas cantan a CG.',
      en: 'A managed material that is not emissive has no bevel, so the edges read as CG.',
    },
    fix: {
      es: 'Anade un bisel (radio del 0.25% del tamano de la unidad, 8 muestras) conectado a la normal del shader de cada material.',
      en: "Adds a bevel (radius 0.25% of the unit size, 8 samples) wired into the normal of each material's shader.",
    },
  },
  {
    key: 'clip',
    label: { es: 'Clipping de camara', en: 'Camera clipping' },
    checks: {
      es: 'El clip start de alguna camara es mayor que el 5% del tamano de la unidad, asi que la pieza se recorta de cerca.',
      en: 'The clip start of a camera is larger than 5% of the unit size, so the model clips up close.',
    },
    fix: {
      es: 'Pone el clip start en el menor entre el 0.5% de la unidad y 0.01, y el clip end en el mayor entre 5000 unidades y 100.',
      en: 'Sets clip start to the smaller of 0.5% of the unit and 0.01, and clip end to the larger of 5000 units and 100.',
    },
  },
  {
    key: 'lights',
    label: { es: 'Visibilidad de luces', en: 'Light visibility' },
    checks: {
      es: 'Alguna luz del estudio es visible a camara, y saldria como un rectangulo.',
      en: 'A studio light is visible to the camera, and would show up as a rectangle.',
    },
    fix: {
      es: 'Oculta las luces a camara y restaura la visibilidad en reflejos de cada rol, salvo las luces de campo claro.',
      en: "Hides the lights from the camera and restores each role's visibility in reflections, except the bright-field lights.",
    },
  },
  {
    key: 'caustics',
    label: { es: 'Fireflies', en: 'Fireflies' },
    checks: {
      es: 'Las caustics estan activas aunque el preset de estudio no las necesita (joyeria, relojeria, perfumeria y optica si), lo que dispara fireflies.',
      en: 'Caustics are on although the active studio preset does not need them (jewellery, watchmaking, fragrance and eyewear do), which causes fireflies.',
    },
    fix: {
      es: 'Pone las caustics reflectivas y refractivas como las pide el preset de estudio.',
      en: 'Sets reflective and refractive caustics to what the studio preset asks for.',
    },
  },
  {
    key: 'persist',
    label: { es: 'Persistent data', en: 'Persistent data' },
    checks: {
      es: 'Los datos persistentes estan activos en los ajustes pero apagados en la escena, lo que hace las animaciones 2-3 veces mas lentas.',
      en: 'Persistent data is enabled in the settings but off in the scene, which makes animations 2-3 times slower.',
    },
    fix: {
      es: 'Enciende los datos persistentes y vuelve a aplicar los ajustes de render.',
      en: 'Turns persistent data on and reapplies the render settings.',
    },
  },
  {
    key: 'output',
    label: { es: 'Formato de salida', en: 'Output format' },
    checks: {
      es: 'El formato de salida es de video (FFMPEG o AVI JPEG), donde un fallo pierde todo el render.',
      en: 'The output format is a video format (FFMPEG or AVI JPEG), where one crash wipes the whole render.',
    },
    fix: {
      es: 'Pasa a PNG si el formato no es de imagen, desactiva sobrescribir y activa los marcadores de posicion para poder reanudar.',
      en: 'Switches to PNG if the format is not an image format, disables overwrite and enables placeholders so a render can resume.',
    },
  },
  // Not from upstream (U13): appended, so the upstream order above is intact.
  {
    key: 'aspect',
    label: { es: 'Proporcion de la animacion', en: 'Animation aspect ratio' },
    checks: {
      es: 'Un plano de la animacion usa una camara con otra proporcion de imagen que el tamano de salida, y un video tiene un solo tamano.',
      en: 'A shot of the animation uses a camera whose image aspect ratio is not that of the output size, and a video has a single size.',
    },
    fix: {
      es: 'Pone a las camaras de esos planos la proporcion del tamano de salida.',
      en: "Gives the cameras of those shots the output size's aspect ratio.",
    },
  },
  // S2, not ported: a part a simulation would drop starts inside the floor (Spanish with accents, like the other
  // data that is not ported). Appended after U13's.
  {
    key: 'physics',
    label: { es: 'Físicas', en: 'Physics' },
    checks: {
      es: 'Una pieza dinámica empieza por debajo del suelo: al simular, el suelo la empujaría o la dejaría caer al vacío.',
      en: 'A dynamic part starts below the floor: in a simulation the floor would push it out or let it fall away.',
    },
    fix: {
      es: 'Sube cada pieza dinámica hasta apoyarla en el suelo.',
      en: 'Lifts each dynamic part until it rests on the floor.',
    },
  },
  // S4a: an ambient effect asks for more particles than its cap. After S2's.
  {
    key: 'particles',
    label: { es: 'Tope de partículas', en: 'Particle cap' },
    checks: {
      es: 'Un efecto de ambiente pide más partículas que su tope (el suyo, o el del motor en Ajustes ▸ Motor de renderizado), así que el motor solo evaluará el tope y se verá menos denso de lo pedido.',
      en: 'An ambient effect asks for more particles than its cap (its own, or the engine\'s in Settings ▸ Render engine), so the engine evaluates only the cap and it looks thinner than asked.',
    },
    fix: {
      es: 'Baja la cantidad de cada efecto que se pasa hasta su tope.',
      en: 'Lowers the amount of every effect that goes over to its cap.',
    },
  },
];

export function doctorCheck(key: string): DoctorCheck | undefined {
  return DOCTOR_CHECKS.find((c) => c.key === key);
}
