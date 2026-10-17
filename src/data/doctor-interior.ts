// K1, not ported from EZ Packshot: the checks of the interior Doctor (INTERIORS.md §3.6), descriptors only, like data/doctor.ts:
// what each check looks at and what its one-click fix does. They run while the scene type is Interior; the logic that runs them
// is core/doctor-interior.ts. Their keys are stable and come after those of data/doctor.ts.

import type { DoctorCheck } from './types';

export const INTERIOR_DOCTOR_CHECKS: readonly DoctorCheck[] = [
  {
    key: 'interiorScale',
    label: { es: 'Escala y unidades', en: 'Scale and units' },
    checks: {
      es: 'El tamaño de la escena no es el de un mueble o una habitación (de 100 mm a 30 m): suele ser un archivo en metros leído como milímetros, o al revés.',
      en: 'The size of the scene is not that of a piece of furniture or a room (100 mm to 30 m): usually a file in metres read as millimetres, or the other way round.',
    },
    fix: {
      es: 'Reescala la escena por la potencia de diez más pequeña que la deja en el rango, o por el factor de unidad que dio el importador.',
      en: 'Rescales the scene by the smallest power of ten that brings it into range, or by the unit factor the importer gave.',
    },
  },
  {
    key: 'interiorOpening',
    label: { es: 'Abertura para el sol y el cielo', en: 'Opening for the sun and sky' },
    checks: {
      es: 'La cámara está dentro de un espacio cerrado que ilumina el sol o el cielo y nada en él es vidrio ni transparente: la luz de fuera no entra.',
      en: 'The camera is inside a closed space lit by the sun or the sky and nothing in it is glass or transparent: the light from outside cannot get in.',
    },
    fix: {
      es: 'Ilumina el espacio por dentro con el montaje Sala blanca de estudio, que cambia el sol y el cielo por paneles y lámparas.',
      en: 'Lights the space from inside with the White studio room setup, which replaces the sun and sky with panels and lamps.',
    },
  },
  {
    key: 'interiorGlass',
    label: { es: 'Vidrio de ventana', en: 'Window glass' },
    checks: {
      es: 'Una pieza plana de vidrio con paredes sólidas, es decir, gruesa o refractiva: un cristal de ventana así llena la imagen de puntos y bloquea la luz explícita del sol.',
      en: 'A flat piece of glass with solid walls, that is, thick or refractive: a window pane like that fills the image with specks and blocks the explicit light of the sun.',
    },
    fix: {
      es: 'Pone el vidrio de esas piezas de paredes finas (sin refracción), en una copia propia si el material lo comparte otra pieza.',
      en: 'Makes the glass of those parts thin-walled (no refraction), in a copy of its own when another part shares the material.',
    },
  },
  {
    key: 'interiorLens',
    label: { es: 'Óptica demasiado angular', en: 'Lens too wide' },
    checks: {
      es: 'Una cámara con una óptica por debajo de 18 mm, que estira los bordes de la imagen.',
      en: 'A camera with a lens below 18 mm, which stretches the edges of the picture.',
    },
    fix: {
      es: 'Pone esas cámaras a 24 mm, la más ancha de las ópticas de interior.',
      en: 'Sets those cameras to 24 mm, the widest of the interior lenses.',
    },
  },
  {
    key: 'interiorEye',
    label: { es: 'Altura de ojo', en: 'Eye height' },
    checks: {
      es: 'Una cámara a una altura que no es la de los ojos de una persona (de 0,3 a 2,2 m sobre el suelo); una cámara bloqueada o una vista ortográfica no cuentan.',
      en: 'A camera at a height that is not where a person’s eyes are (0.3 to 2.2 m above the floor); a locked camera or an orthographic view does not count.',
    },
    fix: {
      es: 'Baja o sube la cámara a 1,5 m, la altura de una persona de pie, mirando al mismo punto desde el mismo lado.',
      en: 'Lowers or raises the camera to 1.5 m, the height of a person standing, looking at the same point from the same side.',
    },
  },
  {
    key: 'interiorClip',
    label: { es: 'Recorte cercano', en: 'Near clipping' },
    checks: {
      es: 'El recorte cercano de una cámara dentro de la habitación llega hasta la pared más próxima: la pared se corta y se ve a través de ella.',
      en: 'The near clip of a camera inside the room reaches the nearest wall: the wall is cut and you see through it.',
    },
    fix: {
      es: 'Pone el recorte cercano a la mitad de la distancia a la pared.',
      en: 'Sets the near clip to half the distance to the wall.',
    },
  },
  {
    key: 'interiorNormals',
    label: { es: 'Normales de las paredes', en: 'Wall normals' },
    checks: {
      es: 'Una superficie cerrada que mira hacia el lado equivocado (hacia dentro si la cámara está fuera, hacia fuera si está dentro) o una pared plana que no mira a la cámara.',
      en: 'A closed surface that faces the wrong way (inwards when the camera is outside, outwards when it is inside) or a flat wall that does not face the camera.',
    },
    fix: {
      es: 'Invierte las normales de esas piezas.',
      en: 'Flips the normals of those parts.',
    },
  },
];
