/**
 * Cinematic camera looks: presets, tunable effect strengths (all 0…1 for the UI) and the
 * colour-grading "looks" they use. Kept free of three.js so the settings store can import it.
 */
export type CinePreset = 'gta' | 'dslr' | 'analog' | 'clean' | 'golden';
export type CineLook = 'gta' | 'neutral' | 'film' | 'golden';

export interface CineValues {
  /** Black Pro-Mist diffusion (wide, soft highlight scatter). */
  mist: number;
  /** Radial chromatic aberration towards the frame edges. */
  chroma: number;
  /** Organic film grain. */
  grain: number;
  /** Corner darkening. */
  vignette: number;
  /** Threshold bloom around bright light sources. */
  bloom: number;
  /** Strength of the colour grade (0 = neutral tone-mapped image). */
  grade: number;
  /** Barrel lens distortion. */
  distortion: number;
}

export interface CinePresetDef {
  label: string;
  look: CineLook;
  values: CineValues;
  /** Fog distance factor (< 1 = more atmospheric haze). */
  haze: number;
}

export const CINE_PRESETS: Record<CinePreset, CinePresetDef> = {
  gta: {
    label: 'GTA Cinematic',
    look: 'gta',
    haze: 0.97,
    values: { mist: 0.45, chroma: 0.25, grain: 0.25, vignette: 0.45, bloom: 0.35, grade: 1, distortion: 0.2 },
  },
  dslr: {
    label: 'Realistic DSLR',
    look: 'neutral',
    haze: 1,
    values: { mist: 0.2, chroma: 0.15, grain: 0.1, vignette: 0.3, bloom: 0.25, grade: 0.8, distortion: 0.15 },
  },
  analog: {
    label: 'Analog Film',
    look: 'film',
    haze: 0.95,
    values: { mist: 0.5, chroma: 0.2, grain: 0.65, vignette: 0.55, bloom: 0.3, grade: 1, distortion: 0.25 },
  },
  clean: {
    label: 'Clean Gameplay',
    look: 'neutral',
    haze: 1.15,
    values: { mist: 0, chroma: 0, grain: 0, vignette: 0.2, bloom: 0, grade: 0.6, distortion: 0 },
  },
  golden: {
    label: 'Golden Hour',
    look: 'golden',
    haze: 0.88,
    values: { mist: 0.65, chroma: 0.2, grain: 0.25, vignette: 0.5, bloom: 0.55, grade: 1, distortion: 0.2 },
  },
};

/** Colour-grading parameters per look (applied after ACES tone mapping, in display space). */
export interface LookDef {
  saturation: number;
  contrast: number;
  /** Multiplier for the shadows (cool) and highlights (warm). */
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  /** Black lift (0.0–0.04) – keeps shadow detail, avoids crushed blacks. */
  lift: number;
  /** Highlight roll-off (film shoulder) 0…1. */
  shoulder: number;
}

export const LOOKS: Record<CineLook, LookDef> = {
  // Warm golden highlights, subtly cooler shadows, rich but natural saturation.
  gta: { saturation: 1.1, contrast: 1.08, shadowTint: [0.95, 0.99, 1.05], highlightTint: [1.06, 1.01, 0.92], lift: 0.012, shoulder: 0.15 },
  neutral: { saturation: 1.04, contrast: 1.05, shadowTint: [0.98, 1.0, 1.02], highlightTint: [1.02, 1.0, 0.98], lift: 0.008, shoulder: 0.1 },
  film: { saturation: 0.94, contrast: 1.02, shadowTint: [0.96, 1.0, 1.02], highlightTint: [1.06, 1.0, 0.88], lift: 0.03, shoulder: 0.35 },
  golden: { saturation: 1.08, contrast: 1.07, shadowTint: [0.94, 0.97, 1.05], highlightTint: [1.13, 1.01, 0.82], lift: 0.015, shoulder: 0.25 },
};

/** Values used in performance mode: cheap effects only (no bloom chain, no multi-tap CA). */
export function performanceValues(v: CineValues): CineValues {
  return { ...v, mist: 0, bloom: 0, chroma: 0 };
}
