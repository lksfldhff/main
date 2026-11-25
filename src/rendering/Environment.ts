import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { ShadowQuality } from '../core/Settings';

const SHADOW_EXTENT = 70; // half-size of the shadow frustum around the player (metres)

/**
 * Sky, sun, ambient light, fog and image-based lighting.
 * The sun's shadow camera follows a focus point (the player) so shadows stay sharp
 * without covering the whole city.
 */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private readonly sky: Sky;
  private readonly sunDirection = new THREE.Vector3();
  private readonly lightRight = new THREE.Vector3();
  private readonly lightUp = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
  ) {
    // Afternoon sun from the south-west: warm light, readable shadows, streets mostly lit.
    // (azimuth measured from +Z/south towards +X/east)
    const elevation = THREE.MathUtils.degToRad(44);
    const azimuth = THREE.MathUtils.degToRad(320);
    this.sunDirection.setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth);

    this.sky = new Sky();
    this.sky.scale.setScalar(4000); // must stay inside the camera far plane
    const u = this.sky.material.uniforms;
    u.turbidity.value = 2.4;
    u.rayleigh.value = 1.3;
    u.mieCoefficient.value = 0.0025;
    u.mieDirectionalG.value = 0.82;
    u.cloudCoverage.value = 0.35;
    u.showSunDisc.value = 0; // the HDR sun disc would bloom over half the screen
    u.sunPosition.value.copy(this.sunDirection);
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xc4d8f2, 0x6a6255, 0.55);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffeedd, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.045;
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_EXTENT;
    cam.right = SHADOW_EXTENT;
    cam.top = SHADOW_EXTENT;
    cam.bottom = -SHADOW_EXTENT;
    cam.near = 1;
    cam.far = 400;
    scene.add(this.sun, this.sun.target);

    scene.fog = new THREE.Fog(0xc4d3de, 260, 1500);
    scene.background = null;

    this.buildEnvironmentMap(renderer);

    // Basis of the light's view plane (used for texel snapping).
    this.lightRight.crossVectors(new THREE.Vector3(0, 1, 0), this.sunDirection).normalize();
    this.lightUp.crossVectors(this.sunDirection, this.lightRight).normalize();
  }

  /**
   * Replaces the procedural-sky environment map with a real HDR sky (Poly Haven, CC0) for
   * more natural ambient light and reflections. The visible sky stays procedural.
   */
  async loadHdri(url: string, renderer: THREE.WebGLRenderer): Promise<void> {
    const hdr = await new HDRLoader().loadAsync(url);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
    pmrem.dispose();
    this.scene.environment?.dispose();
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.5;
    // Rotate so the HDRI's bright sky region roughly matches our sun azimuth.
    this.scene.environmentRotation.set(0, THREE.MathUtils.degToRad(120), 0);
  }

  setShadowQuality(quality: ShadowQuality): void {
    const size = quality === 'high' ? 4096 : 2048;
    this.sun.castShadow = quality !== 'off';
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  /** Centers the shadow frustum on `focus`, snapped to shadow-map texels to avoid shimmering. */
  updateShadowFocus(focus: THREE.Vector3): void {
    const texel = (SHADOW_EXTENT * 2) / this.sun.shadow.mapSize.x;
    const r = Math.round(focus.dot(this.lightRight) / texel) * texel;
    const up = Math.round(focus.dot(this.lightUp) / texel) * texel;
    const d = focus.dot(this.sunDirection);
    const snapped = new THREE.Vector3()
      .addScaledVector(this.lightRight, r)
      .addScaledVector(this.lightUp, up)
      .addScaledVector(this.sunDirection, d);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(this.sunDirection, 200);
    this.sun.target.updateMatrixWorld();
  }

  update(elapsed: number): void {
    this.sky.material.uniforms.time.value = elapsed;
  }

  private buildEnvironmentMap(renderer: THREE.WebGLRenderer): void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(1000);
    envSky.material.uniforms.sunPosition.value.copy(this.sunDirection);
    envSky.material.uniforms.turbidity.value = 3.2;
    envSky.material.uniforms.rayleigh.value = 1.4;
    envSky.material.uniforms.cloudCoverage.value = 0;
    envScene.add(envSky);
    this.scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    this.scene.environmentIntensity = 0.38;
    pmrem.dispose();
  }
}
