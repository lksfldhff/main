/**
 * Visual building styles. Heilbronn's centre was largely rebuilt after 1944, so post-war
 * plaster facades with flat roofs dominate, mixed with red sandstone and a few gabled houses.
 */
export type GroundFloorType = 'shop' | 'plinth' | 'glass';
export type RoofType = 'flat' | 'gable';
export type MullionType = 'cross' | 'vertical' | 'none';

export interface FacadeStyle {
  id: string;
  wall: string;
  trim: string;
  frame: string;
  glassTop: string;
  glassBottom: string;
  /** Window size/position as fractions of one bay (width) and one floor (height, from top). */
  window: { width: number; height: number; top: number };
  mullions: MullionType;
  shutters?: string;
  ribbon?: boolean;
  ground: GroundFloorType;
  plinth: string;
  awning?: string;
  roofType: RoofType;
  roofColor: string;
  bayWidth: number;
  floorHeight: number;
  groundHeight: number;
}

const GLASS = { glassTop: '#8fb3c9', glassBottom: '#2d4250' };

export const FACADE_STYLES: readonly FacadeStyle[] = [
  {
    id: 'nachkrieg-creme',
    wall: '#e8dcc4',
    trim: '#f5efe2',
    frame: '#f7f4ee',
    ...GLASS,
    window: { width: 0.46, height: 0.5, top: 0.22 },
    mullions: 'vertical',
    ground: 'shop',
    plinth: '#8a8277',
    awning: '#2f5d62',
    roofType: 'flat',
    roofColor: '#77736c',
    bayWidth: 3.1,
    floorHeight: 3.1,
    groundHeight: 4.2,
  },
  {
    id: 'sandstein-rot',
    wall: '#b26a52',
    trim: '#d8b58f',
    frame: '#efe6d8',
    ...GLASS,
    window: { width: 0.44, height: 0.56, top: 0.2 },
    mullions: 'cross',
    ground: 'plinth',
    plinth: '#8c4d3b',
    roofType: 'gable',
    roofColor: '#7a3b2c',
    bayWidth: 3.3,
    floorHeight: 3.5,
    groundHeight: 4.0,
  },
  {
    id: 'ocker',
    wall: '#d9a55b',
    trim: '#f3e6cb',
    frame: '#ffffff',
    ...GLASS,
    window: { width: 0.42, height: 0.54, top: 0.2 },
    mullions: 'cross',
    shutters: '#4f6e5c',
    ground: 'shop',
    plinth: '#7e6e5c',
    awning: '#a33a2f',
    roofType: 'gable',
    roofColor: '#9a4630',
    bayWidth: 3.0,
    floorHeight: 3.2,
    groundHeight: 4.0,
  },
  {
    id: 'salbei',
    wall: '#a9b69a',
    trim: '#eef0e5',
    frame: '#f2f2ee',
    ...GLASS,
    window: { width: 0.48, height: 0.52, top: 0.22 },
    mullions: 'vertical',
    ground: 'plinth',
    plinth: '#6c6f68',
    roofType: 'gable',
    roofColor: '#4d4f55',
    bayWidth: 3.2,
    floorHeight: 3.1,
    groundHeight: 3.6,
  },
  {
    id: 'pastellblau',
    wall: '#a8c0cc',
    trim: '#f1f3f2',
    frame: '#ffffff',
    ...GLASS,
    window: { width: 0.5, height: 0.5, top: 0.22 },
    mullions: 'vertical',
    ground: 'shop',
    plinth: '#6d7a80',
    awning: '#e0b24a',
    roofType: 'flat',
    roofColor: '#6f7174',
    bayWidth: 3.2,
    floorHeight: 3.1,
    groundHeight: 4.2,
  },
  {
    id: 'fuenfziger-weiss',
    wall: '#efede6',
    trim: '#cfcac0',
    frame: '#3b4247',
    ...GLASS,
    window: { width: 0.92, height: 0.46, top: 0.24 },
    mullions: 'vertical',
    ribbon: true,
    ground: 'glass',
    plinth: '#55585b',
    roofType: 'flat',
    roofColor: '#7a7874',
    bayWidth: 2.6,
    floorHeight: 3.2,
    groundHeight: 4.4,
  },
  {
    id: 'klinker',
    wall: '#9b5641',
    trim: '#d6cfc2',
    frame: '#e9e4da',
    ...GLASS,
    window: { width: 0.5, height: 0.55, top: 0.2 },
    mullions: 'cross',
    ground: 'shop',
    plinth: '#4e3a33',
    awning: '#33434f',
    roofType: 'flat',
    roofColor: '#6c6863',
    bayWidth: 3.0,
    floorHeight: 3.2,
    groundHeight: 4.2,
  },
  {
    id: 'buero-glas',
    wall: '#56636b',
    trim: '#9aa5ab',
    frame: '#2b3338',
    glassTop: '#a5c6d8',
    glassBottom: '#36505f',
    window: { width: 0.96, height: 0.7, top: 0.12 },
    mullions: 'vertical',
    ribbon: true,
    ground: 'glass',
    plinth: '#2f3539',
    roofType: 'flat',
    roofColor: '#5d6062',
    bayWidth: 2.4,
    floorHeight: 3.6,
    groundHeight: 4.8,
  },
];

export function getFacadeStyle(id: string): FacadeStyle {
  const style = FACADE_STYLES.find((s) => s.id === id);
  if (!style) throw new Error(`Unknown facade style: ${id}`);
  return style;
}
