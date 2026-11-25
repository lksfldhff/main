/**
 * Converts WGS84 coordinates (lat/lon from OpenStreetMap) into the game's local metric
 * coordinate system. Using a local origin keeps all world coordinates small (< a few km),
 * which avoids floating-point jitter in the GPU and physics engine.
 *
 * Axes: +X = east, -Z = north, +Y = up. 1 unit = 1 metre.
 * Projection: local equirectangular tangent plane – error < 0.1 % within ~10 km of the origin,
 * which is far below what is visible in-game.
 */
export interface GeoPoint {
  lat: number;
  lon: number;
}

const EARTH_RADIUS = 6_378_137; // WGS84 semi-major axis in metres

/** Provisional origin: Heilbronn Marktplatz (in front of the Rathaus). Refined in Phase 2. */
export const HEILBRONN_ORIGIN: GeoPoint = { lat: 49.14205, lon: 9.21885 };

export class GeoProjection {
  private readonly cosLat: number;

  constructor(readonly origin: GeoPoint = HEILBRONN_ORIGIN) {
    this.cosLat = Math.cos((origin.lat * Math.PI) / 180);
  }

  /** WGS84 → local metres { x: east, z: south }. */
  toLocal(p: GeoPoint): { x: number; z: number } {
    const dLat = ((p.lat - this.origin.lat) * Math.PI) / 180;
    const dLon = ((p.lon - this.origin.lon) * Math.PI) / 180;
    return {
      x: dLon * EARTH_RADIUS * this.cosLat,
      z: -dLat * EARTH_RADIUS,
    };
  }

  /** Local metres → WGS84 (useful for debugging / minimap). */
  toGeo(x: number, z: number): GeoPoint {
    return {
      lat: this.origin.lat + (-z / EARTH_RADIUS) * (180 / Math.PI),
      lon: this.origin.lon + (x / (EARTH_RADIUS * this.cosLat)) * (180 / Math.PI),
    };
  }
}
