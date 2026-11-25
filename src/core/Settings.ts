export type ShadowQuality = 'off' | 'low' | 'high';
export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface GameSettings {
  mouseSensitivity: number;
  invertY: boolean;
  shadowQuality: ShadowQuality;
  graphicsQuality: GraphicsQuality;
  renderScale: number;
  fov: number;
  showDebug: boolean;
}

const STORAGE_KEY = 'gta-heilbronn.settings.v1';

const DEFAULTS: GameSettings = {
  mouseSensitivity: 1,
  invertY: false,
  shadowQuality: 'high',
  graphicsQuality: 'high',
  renderScale: 1,
  fov: 62,
  showDebug: false,
};

type Listener = (settings: Readonly<GameSettings>) => void;

/** Persistent user settings (localStorage) with change notifications. */
export class SettingsStore {
  private data: GameSettings;
  private listeners = new Set<Listener>();

  constructor() {
    this.data = { ...DEFAULTS, ...SettingsStore.load() };
  }

  get values(): Readonly<GameSettings> {
    return this.data;
  }

  update(patch: Partial<GameSettings>): void {
    this.data = { ...this.data, ...patch };
    this.save();
    this.listeners.forEach((l) => l(this.data));
  }

  reset(): void {
    this.update({ ...DEFAULTS });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* storage may be unavailable (private mode) – settings stay in memory */
    }
  }

  private static load(): Partial<GameSettings> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Partial<GameSettings>) : {};
    } catch {
      return {};
    }
  }
}
