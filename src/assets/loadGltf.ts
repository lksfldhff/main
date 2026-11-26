import type { GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Loads a GLB. Hosts that refuse to serve raw binaries (sandboxed previews) can ship a
 * base64 copy next to it as `<name>.b64.txt`, which is used as a fallback.
 */
export async function loadGltf(loader: GLTFLoader, url: string): Promise<GLTF> {
  try {
    const res = await fetch(url);
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && !type.includes('text/html')) return await loader.parseAsync(await res.arrayBuffer(), url.slice(0, url.lastIndexOf('/') + 1));
  } catch {
    /* fall through to the base64 copy */
  }
  const res = await fetch(`${url}.b64.txt`);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  const bin = atob((await res.text()).trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return loader.parseAsync(bytes.buffer, url.slice(0, url.lastIndexOf('/') + 1));
}
