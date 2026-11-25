/**
 * Facade/roof style tables. Style ids are assigned offline (tools/geo/build_heilbronn.py)
 * from the ALKIS building function, roof type and height; these tables define the look.
 */
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

export const STYLES: StyleTable = {
  //          Altbau Postwar Modern Glass Sandst Indust Small Brick Bridge Historic
  wallLayer: [0, 0, 3, 3, 2, 4, 0, 1, 3, 0],
  wallTile: [3.5, 3.5, 3, 3, 5.5, 2.5, 3.5, 2.2, 4, 3.5],
  floorHeight: [3.3, 3.0, 3.6, 4.0, 11.0, 5.0, 3.0, 3.3, 3.0, 4.2],
  groundHeight: [4.0, 3.8, 4.6, 5.0, 0.01, 5.0, 3.0, 4.0, 3.0, 4.8],
  bayWidth: [2.9, 2.7, 1.8, 1.6, 5.0, 6.0, 3.0, 2.9, 3.0, 3.4],
  window: [
    [1.15, 1.65, 0.85],
    [1.35, 1.45, 0.9],
    [-0.14, 1.9, 0.85],
    [-0.06, 3.6, 0.15],
    [1.5, 6.0, 3.0],
    [-1.2, 1.2, 3.0],
    [0, 0, 0],
    [1.15, 1.65, 0.85],
    [0, 0, 0],
    [1.2, 2.3, 1.0],
  ],
  frameDark: [0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
  palette: [
    ['#efe4cc', '#e2c48f', '#ead9a4', '#dcb6a2', '#e9ece6', '#cfd8cc', '#e6cfa3', '#f1ebdf'],
    ['#ebe7dd', '#dcd5c6', '#cfc8b8', '#e5d7bc', '#d9dcd8', '#e9e1cf', '#c7c0b0', '#efe9dc'],
    ['#d4d2cc', '#c3c1bc', '#e2dfd8', '#b4b3b0', '#d8d3c8', '#c9ccc9', '#dedcd6', '#bdbab3'],
    ['#b9c6cc', '#a9b6bc', '#c3ccce', '#9fb0b8', '#b9c6cc', '#a9b6bc', '#c3ccce', '#9fb0b8'],
    ['#d79c84', '#cf927a', '#dba58e', '#c98a74', '#d79c84', '#cf927a', '#dba58e', '#c98a74'],
    ['#c5ccd0', '#b6bcbc', '#9da8ae', '#c9c0ae', '#aeb7b2', '#c2c6c8', '#a7adb0', '#bdb7a8'],
    ['#ddd8cd', '#cfc9bd', '#e3ded4', '#c4beb3', '#ddd8cd', '#cfc9bd', '#e3ded4', '#c4beb3'],
    ['#ffffff', '#f2e8e2', '#e6dcd6', '#fff6ef', '#ffffff', '#f2e8e2', '#e6dcd6', '#fff6ef'],
    ['#d0cec8', '#c7c5bf', '#d0cec8', '#c7c5bf', '#d0cec8', '#c7c5bf', '#d0cec8', '#c7c5bf'],
    ['#f6e9d4', '#f1e2c8', '#f6e9d4', '#f1e2c8', '#f6e9d4', '#f1e2c8', '#f6e9d4', '#f1e2c8'],
  ],
};

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
