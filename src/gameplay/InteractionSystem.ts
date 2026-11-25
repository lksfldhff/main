import type * as THREE from 'three';

export interface Interactable {
  /** World position used for distance checks. */
  position: THREE.Vector3;
  radius: number;
  prompt: string;
  onInteract(): void;
}

/**
 * Finds the closest interactable in reach of the player. Generic on purpose:
 * vehicles (enter/exit), doors and mission triggers will plug into the same system.
 */
export class InteractionSystem {
  private items = new Set<Interactable>();
  private current: Interactable | null = null;

  register(item: Interactable): () => void {
    this.items.add(item);
    return () => this.items.delete(item);
  }

  get focused(): Interactable | null {
    return this.current;
  }

  update(playerPosition: THREE.Vector3): Interactable | null {
    let best: Interactable | null = null;
    let bestDist = Infinity;
    for (const item of this.items) {
      const dx = item.position.x - playerPosition.x;
      const dz = item.position.z - playerPosition.z;
      const dy = Math.abs(item.position.y - playerPosition.y);
      const d = Math.hypot(dx, dz);
      if (d <= item.radius && dy < 3 && d < bestDist) {
        best = item;
        bestDist = d;
      }
    }
    this.current = best;
    return best;
  }

  interact(): boolean {
    if (!this.current) return false;
    this.current.onInteract();
    return true;
  }
}
