import * as THREE from 'three';
import type { FacadeStyle } from '../world/buildings/FacadeStyles';
import { drawGroundFacade, drawUpperFacade } from './textures/FacadeTextures';
import * as Surfaces from './textures/SurfaceTextures';
import { concrete, type SurfaceTextureSet } from './textures/SurfaceTextures';

export type SurfaceName =
  | 'asphalt'
  | 'paving'
  | 'cobblestone'
  | 'curb'
  | 'grass'
  | 'roofGravel'
  | 'quayStone'
  | 'markings'
  | 'zebra';

export interface FacadeMaterials {
  ground: THREE.MeshStandardMaterial;
  upper: THREE.MeshStandardMaterial;
  plain: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
}

/**
 * Creates and caches every material in the game. Sharing materials is essential for
 * batching (one draw call per material per chunk) and for keeping GPU memory low.
 *
 * Convention: world surfaces use UVs in metres; the texture repeat converts to tiles.
 * Facades use UVs in bays/floors (repeat = 1).
 */
export class MaterialLibrary {
  private surfaces = new Map<SurfaceName, THREE.MeshStandardMaterial>();
  private facades = new Map<string, FacadeMaterials>();
  private colors = new Map<string, THREE.MeshStandardMaterial>();
  private roofTileMaterials = new Map<string, THREE.MeshStandardMaterial>();

  constructor(readonly anisotropy: number) {}

  surface(name: SurfaceName): THREE.MeshStandardMaterial {
    let mat = this.surfaces.get(name);
    if (!mat) {
      mat = this.createSurface(name);
      this.surfaces.set(name, mat);
    }
    return mat;
  }

  /** Untextured material for props (shared per colour/roughness/metalness combination). */
  color(hex: string, roughness = 0.8, metalness = 0): THREE.MeshStandardMaterial {
    const key = `${hex}|${roughness}|${metalness}`;
    let mat = this.colors.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ color: hex, roughness, metalness });
      this.colors.set(key, mat);
    }
    return mat;
  }

  facade(style: FacadeStyle): FacadeMaterials {
    let set = this.facades.get(style.id);
    if (!set) {
      set = {
        ground: this.facadeMaterial(drawGroundFacade(style, 'color'), drawGroundFacade(style, 'rough')),
        upper: this.facadeMaterial(drawUpperFacade(style, 'color'), drawUpperFacade(style, 'rough')),
        plain: this.color(style.wall, 0.92),
        trim: this.color(style.trim, 0.75),
        roof: style.roofType === 'gable' ? this.roofTiles(style.roofColor) : this.surface('roofGravel'),
      };
      this.facades.set(style.id, set);
    }
    return set;
  }

  canvasMaterial(canvas: HTMLCanvasElement, roughness = 0.7): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ map: this.colorTexture(canvas), roughness });
  }

  private roofTiles(color: string): THREE.MeshStandardMaterial {
    let mat = this.roofTileMaterials.get(color);
    if (!mat) {
      mat = this.fromSet(Surfaces.roofTiles(color), { roughness: 0.75 });
      this.roofTileMaterials.set(color, mat);
    }
    return mat;
  }

  private createSurface(name: SurfaceName): THREE.MeshStandardMaterial {
    switch (name) {
      case 'asphalt':
        return this.fromSet(Surfaces.asphalt(), { roughness: 0.92 });
      case 'paving':
        return this.fromSet(Surfaces.paving(), { roughness: 0.88 });
      case 'cobblestone':
        return this.fromSet(Surfaces.cobblestone(), { roughness: 0.85 });
      case 'curb':
        return this.fromSet(concrete('#a9a69f'), { roughness: 0.9 });
      case 'grass':
        return this.fromSet(Surfaces.grass(), { roughness: 0.98 });
      case 'roofGravel':
        return this.fromSet(Surfaces.roofGravel(), { roughness: 0.95 });
      case 'quayStone':
        return this.fromSet(Surfaces.quayStone(), { roughness: 0.9 });
      case 'markings':
        return this.fromSet(Surfaces.roadMarkings(), decalParams(), [1, 1 / 9]);
      case 'zebra':
        return this.fromSet(Surfaces.zebraCrossing(), decalParams());
    }
  }

  private fromSet(
    set: SurfaceTextureSet,
    params: THREE.MeshStandardMaterialParameters,
    repeat: [number, number] = [1 / set.tileSize, 1 / set.tileSize],
  ): THREE.MeshStandardMaterial {
    const map = this.colorTexture(set.color);
    map.repeat.set(...repeat);
    const mat = new THREE.MeshStandardMaterial({ map, ...params });
    if (set.normal) {
      const normalMap = this.dataTexture(set.normal);
      normalMap.repeat.set(...repeat);
      mat.normalMap = normalMap;
      mat.normalScale.set(0.8, 0.8);
    }
    return mat;
  }

  private facadeMaterial(color: HTMLCanvasElement, rough: HTMLCanvasElement): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      map: this.colorTexture(color),
      roughnessMap: this.dataTexture(rough),
      roughness: 1,
      metalness: 0,
    });
  }

  private colorTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = this.anisotropy;
    return tex;
  }

  private dataTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = this.anisotropy;
    return tex;
  }
}

function decalParams(): THREE.MeshStandardMaterialParameters {
  return {
    transparent: true,
    depthWrite: false,
    roughness: 0.7,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  };
}

