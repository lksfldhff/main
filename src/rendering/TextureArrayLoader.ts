import * as THREE from 'three';

/**
 * Loads several equally sized images into one THREE.DataArrayTexture (sampler2DArray).
 * One array per surface family keeps the number of texture units low, so a single
 * material (= one draw call) can render many different surface types.
 */
export async function loadTextureArray(
  urls: string[],
  size: number,
  options: { srgb: boolean; anisotropy: number },
): Promise<THREE.DataArrayTexture> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const layerBytes = size * size * 4;
  const data = new Uint8Array(layerBytes * urls.length);

  const bitmaps = await Promise.all(
    urls.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load ${url}`);
      return createImageBitmap(await res.blob(), { colorSpaceConversion: 'none' });
    }),
  );
  bitmaps.forEach((bmp, i) => {
    // Flip vertically so image-up = +v (standard GL convention, matches normal maps).
    ctx.setTransform(1, 0, 0, -1, 0, size);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(bmp, 0, 0, size, size);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    data.set(ctx.getImageData(0, 0, size, size).data, i * layerBytes);
    bmp.close();
  });

  const tex = new THREE.DataArrayTexture(data, size, size, urls.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = options.anisotropy;
  tex.colorSpace = options.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function textureUrls(names: string[], suffix: 'diff' | 'nrm'): string[] {
  const base = import.meta.env.BASE_URL;
  return names.map((n) => `${base}assets/textures/${n}_${suffix}.jpg`);
}
