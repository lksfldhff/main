import type * as THREE from 'three';
import type { VehicleSpawn } from '../vehicles/VehicleManager';

/** What the game needs to know about a loaded district (test grid or real Heilbronn). */
export interface District {
  name: string;
  spawn: THREE.Vector3;
  spawnYaw: number;
  /** Centre used by the menu camera fly-around. */
  showcaseCenter: THREE.Vector3;
  showcaseRadius: number;
  /** Parked cars to spawn. */
  vehicleSpawns?: VehicleSpawn[];
  /** Data source credits shown in the UI (e.g. OSM / LGL licence notes). */
  attribution?: string;
  /** Per-frame animation (water etc.). */
  update?(elapsed: number): void;
  /** Camera-dependent streaming / LOD (facade modules etc.). */
  updateView?(camera: THREE.Vector3): void;
  /** Placement records for the automated visual QA (tools/qa/dump_scene.cjs). */
  qa?(): unknown;
  /** Extra lines for the performance monitor. */
  stats?(): string;
  /** Human-readable location (street / square) for the HUD. */
  locate?(position: THREE.Vector3): string | null;
  /** Terrain height at (x, z), if the district has terrain. */
  groundHeight?(x: number, z: number): number;
  /** True when the position is in deep water (player gets rescued to land). */
  isInDeepWater?(position: THREE.Vector3): boolean;
}
