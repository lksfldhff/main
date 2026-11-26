import * as THREE from 'three';

/**
 * Shared time-of-day state for shaders and materials (0 = day, 1 = night).
 * Facade windows, shop fronts and lamp bulbs read it to light up at night.
 */
export const nightUniform = { value: 0 };

const bulbs = new Set<THREE.MeshStandardMaterial>();

/** Registers a lamp bulb / lantern glass material that glows at night. */
export function registerBulb(material: THREE.MeshStandardMaterial): void {
  bulbs.add(material);
  applyBulb(material);
}

function applyBulb(m: THREE.MeshStandardMaterial): void {
  const n = nightUniform.value;
  m.emissive.setRGB(1.0, 0.78, 0.48);
  m.emissiveIntensity = n * 6;
}

export function setNight(n: number): void {
  nightUniform.value = n;
  bulbs.forEach(applyBulb);
}
