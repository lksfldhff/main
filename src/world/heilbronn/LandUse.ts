/** Land-use classes in landuse.png. Must match tools/geo/build_heilbronn.py. */
export const LandUse = {
  None: 0,
  Road: 1,
  Sidewalk: 2,
  Plaza: 3,
  Path: 4,
  Water: 5,
  Green: 6,
  Urban: 7,
  Rail: 8,
} as const;

/**
 * Ground texture-array layer for each land-use class
 * (layers: 0 asphalt, 1 sidewalk, 2 plaza, 3 path, 4 grass, 5 urban paving, 6 rail gravel).
 */
export const LANDUSE_TO_LAYER = [4, 0, 1, 2, 3, 3, 4, 5, 6];

export const GROUND_TEXTURES = ['asphalt', 'sidewalk', 'plaza', 'path', 'grass', 'urban', 'rail'].map((n) => `ground_${n}`);
