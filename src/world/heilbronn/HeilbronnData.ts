/**
 * Loader for the preprocessed Heilbronn data in public/data/heilbronn/
 * (generated offline by tools/geo/build_heilbronn.py – see README).
 */

export interface ChunkRange {
  offset: number;
  vertices: number;
}

export interface BuildingChunk {
  cx: number;
  cz: number;
  walls: ChunkRange;
  roofs: ChunkRange;
}

export interface Poi {
  name: string;
  kind: 'building' | 'area';
  x: number;
  z: number;
}

export interface StreetLabel {
  name: string;
  x: number;
  z: number;
}

export interface HeilbronnMeta {
  version: number;
  attribution: string;
  origin: { e: number; n: number; height: number; crs: string };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  terrain: { cols: number; rows: number; cell: number; minHeight: number; scale: number };
  landuse: { width: number; height: number; cell: number };
  water: { vertices: number };
  buildings: { count: number; chunkSize: number; wallStride: number; roofStride: number; chunks: BuildingChunk[] };
  pois: Poi[];
  streets: StreetLabel[];
}

export interface HeilbronnData {
  meta: HeilbronnMeta;
  /** Heights in metres (local, relative to the Marktplatz), row-major, row 0 = north. */
  heights: Float32Array;
  buildings: ArrayBuffer;
  water: Float32Array;
  /** Land-use class per pixel, row 0 = north. */
  landuse: Uint8Array;
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res;
}

/**
 * Loads a binary file. Hosts that refuse to serve raw binaries (e.g. sandboxed previews)
 * can ship a base64 copy next to it as `<name>.b64.txt`, used as a fallback.
 */
async function fetchBinary(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  const type = res.headers.get('content-type') ?? '';
  if (res.ok && !type.includes('text/html')) return res.arrayBuffer();
  const b64 = await (await fetchOk(`${url}.b64.txt`)).text();
  const bin = atob(b64.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function loadGrayscalePng(url: string, width: number, height: number): Promise<Uint8Array> {
  const blob = await (await fetchOk(url)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
  return out;
}

export async function loadHeilbronnData(baseUrl: string, onProgress?: (text: string) => void): Promise<HeilbronnData> {
  onProgress?.('Kartendaten …');
  const meta = (await (await fetchOk(`${baseUrl}/meta.json`)).json()) as HeilbronnMeta;

  onProgress?.('Gelände, Gebäude, Flächen …');
  const [terrainBuf, buildings, waterBuf, landuse] = await Promise.all([
    fetchBinary(`${baseUrl}/terrain.bin`),
    fetchBinary(`${baseUrl}/buildings.bin`),
    fetchBinary(`${baseUrl}/water.bin`),
    loadGrayscalePng(`${baseUrl}/landuse.png`, meta.landuse.width, meta.landuse.height),
  ]);

  const raw = new Uint16Array(terrainBuf);
  const heights = new Float32Array(raw.length);
  const { minHeight, scale } = meta.terrain;
  for (let i = 0; i < raw.length; i++) heights[i] = minHeight + raw[i] * scale;

  return { meta, heights, buildings, water: new Float32Array(waterBuf), landuse };
}
