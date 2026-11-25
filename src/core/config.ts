/**
 * Central tuning values. Units: metres, seconds, radians.
 * World axes: +X = east, -Z = north, +Y = up (see geo/GeoProjection.ts).
 */
export const GAME_TITLE = 'GTA Heilbronn';
export const GAME_SUBTITLE = 'Open World · Prototyp';
export const BUILD_PHASE = 'Phase 2 – Echtes Heilbronn';

export const CONFIG = {
  physics: {
    fixedDt: 1 / 60,
    maxSubSteps: 5,
    gravity: -24,
  },
  player: {
    radius: 0.32,
    /** Half height of the cylindrical part of the capsule. Total height = 2*(halfHeight+radius). */
    halfHeight: 0.58,
    walkSpeed: 4.3,
    runSpeed: 8.2,
    jumpVelocity: 8.2,
    groundAcceleration: 14,
    airAcceleration: 2.5,
    turnSharpness: 14,
    stepHeight: 0.35,
    maxSlopeDeg: 50,
    respawnBelowY: -30,
  },
  camera: {
    fov: 62,
    sprintFovBoost: 6,
    near: 0.1,
    far: 2500,
    distance: 5.2,
    minDistance: 2.2,
    maxDistance: 10,
    pivotHeight: 1.55,
    shoulderOffset: 0.5,
    minPitch: -0.65,
    maxPitch: 1.25,
    baseSensitivity: 0.0022,
    horizontalFollowSharpness: 20,
    verticalFollowSharpness: 9,
    collisionPadding: 0.25,
    /** Minimum camera height above the player's feet. */
    floorClearance: 0.45,
  },
  world: {
    chunkSize: 128,
  },
} as const;
