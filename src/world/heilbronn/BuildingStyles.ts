/**
 * Facade/roof style tables. Style ids are assigned offline (tools/geo/build_heilbronn.py)
 * from the ALKIS building function, roof type and height; these tables define the look.
 */
import facadeStyles from './facadeStyles.json';

export const Style = {
  Altbau: 0,
  Postwar: 1,
  Modern: 2,
  Glass: 3,
  Sandstone: 4,
  Industrial: 5,
  Small: 6,
  Brick: 7,
  Bridge: 8,
  Historic: 9,
} as const;

export const STYLE_COUNT = 10;

export const WALL_TEXTURES = ['plaster', 'brick', 'sandstone', 'concrete', 'metal'].map((n) => `wall_${n}`);
export const ROOF_TEXTURES = ['clay', 'slate', 'metal', 'flat'].map((n) => `roof_${n}`);

/** Per style (index = style id). */
export interface StyleTable {
  wallLayer: number[];
  wallTile: number[];
  floorHeight: number[];
  groundHeight: number[];
  bayWidth: number[];
  /** x = window width (0 = no windows, <0 = ribbon: full bay minus |x|), y = height, z = sill height. */
  window: [number, number, number][];
  frameDark: number[];
  palette: string[][];
}

export const STYLES: StyleTable = facadeStyles as unknown as StyleTable;


/** Shop fascia / awning accent colours. */
export const SHOP_ACCENTS = ['#2f5d62', '#a33a2f', '#2b3a4a', '#d8a33a', '#5b3c5f', '#3f6b3a', '#1f1f1f', '#8a4b2a'];

/** Roof kinds (index = kind id from the data). layer = ROOF_TEXTURES index. */
export const ROOFS = {
  layer: [3, 0, 1, 2, 2],
  tile: [4, 2.4, 2.4, 3, 3],
  roughness: [0.95, 0.75, 0.6, 0.45, 0.5],
  metalness: [0, 0, 0.05, 0.55, 0.45],
  palette: [
    ['#9a9690', '#8a8782', '#a5a19a', '#7f7c77'],
    ['#c9a493', '#b38a7a', '#a07a6c', '#bf9a88'],
    ['#ffffff', '#d5d8dc', '#b8bcc0', '#e6e6e6'],
    ['#ffffff', '#d9dde0', '#c3c9cd', '#b4b9bb'],
    ['#8fbfa9', '#86b5a0', '#95c4ae', '#7fae99'],
  ],
};
