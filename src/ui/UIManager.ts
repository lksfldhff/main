import type { SettingsStore } from '../core/Settings';
import { StartScreen } from './screens/StartScreen';
import { PauseMenu } from './screens/PauseMenu';
import { SettingsPanel } from './screens/SettingsPanel';
import { Hud } from './hud/Hud';
import { DebugOverlay } from './hud/DebugOverlay';
import { h } from './dom';

export interface UIActions {
  onStart(): void;
  onResume(): void;
  onRespawn(): void;
  onMainMenu(): void;
}

type Screen = 'start' | 'pause' | 'none';

/** Owns all DOM UI and switches between screens. Contains no game logic. */
export class UIManager {
  readonly hud = new Hud();
  readonly debug = new DebugOverlay();
  private readonly start: StartScreen;
  private readonly pause: PauseMenu;
  private readonly settingsLayer: HTMLElement;
  private screen: Screen = 'start';

  constructor(root: HTMLElement, settings: SettingsStore, actions: UIActions) {
    this.start = new StartScreen({ onStart: actions.onStart, onSettings: () => this.openSettings() });
    this.pause = new PauseMenu({
      onResume: actions.onResume,
      onSettings: () => this.openSettings(),
      onRespawn: actions.onRespawn,
      onMainMenu: actions.onMainMenu,
    });
    const settingsPanel = new SettingsPanel(settings, () => this.closeSettings());
    this.settingsLayer = h('section', { class: 'screen settings-screen hidden' }, settingsPanel.element);

    root.append(this.hud.element, this.debug.element, this.start.element, this.pause.element, this.settingsLayer);
    this.showScreen('start');

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !this.settingsLayer.classList.contains('hidden')) this.closeSettings();
    });
  }

  get startScreen(): StartScreen {
    return this.start;
  }

  get settingsOpen(): boolean {
    return !this.settingsLayer.classList.contains('hidden');
  }

  showScreen(screen: Screen): void {
    this.screen = screen;
    this.settingsLayer.classList.add('hidden');
    this.start.element.classList.toggle('hidden', screen !== 'start');
    this.pause.element.classList.toggle('hidden', screen !== 'pause');
    this.hud.show(screen === 'none');
  }

  private openSettings(): void {
    this.start.element.classList.add('hidden');
    this.pause.element.classList.add('hidden');
    this.settingsLayer.classList.remove('hidden');
  }

  private closeSettings(): void {
    this.settingsLayer.classList.add('hidden');
    this.showScreen(this.screen);
  }
}
