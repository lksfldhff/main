import { BUILD_PHASE, GAME_SUBTITLE, GAME_TITLE } from '../../core/config';
import { h, keycap } from '../dom';

export interface StartScreenActions {
  onStart(): void;
  onSettings(): void;
}

export class StartScreen {
  readonly element: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly attribution: HTMLElement;

  constructor(actions: StartScreenActions) {
    const [first, ...rest] = GAME_TITLE.split(' ');
    this.startButton = h('button', { type: 'button', class: 'btn btn-primary', disabled: true, onclick: () => actions.onStart() }, 'Spiel starten');
    this.statusText = h('span', { class: 'loading-text' }, 'Welt wird geladen …');
    this.status = h('div', { class: 'loading-status' }, h('span', { class: 'spinner' }), this.statusText);
    this.attribution = h('span', { class: 'attribution' });

    const controls: [string[], string][] = [
      [['W', 'A', 'S', 'D'], 'Bewegen'],
      [['Maus'], 'Kamera'],
      [['Shift'], 'Rennen'],
      [['Leertaste'], 'Springen'],
      [['E'], 'Interagieren'],
      [['Esc'], 'Pause'],
    ];

    this.element = h(
      'section',
      { class: 'screen start-screen' },
      h(
        'div',
        { class: 'start-content' },
        h(
          'header',
          { class: 'brand' },
          h('div', { class: 'brand-kicker' }, GAME_SUBTITLE),
          h('h1', { class: 'brand-title' }, h('span', { class: 'brand-small' }, first), h('span', {}, rest.join(' ') || first)),
          h('div', { class: 'brand-line' }),
        ),
        h(
          'nav',
          { class: 'menu' },
          this.startButton,
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => actions.onSettings() }, 'Einstellungen'),
        ),
        this.status,
        h(
          'div',
          { class: 'controls-card' },
          ...controls.map(([keys, label]) => h('div', { class: 'control-row' }, h('span', { class: 'keys' }, ...keys.map(keycap)), h('span', {}, label))),
        ),
      ),
      h(
        'footer',
        { class: 'start-footer' },
        h('span', {}, BUILD_PHASE),
        this.attribution,
        h('span', {}, 'Texturen: Poly Haven (CC0) · Eigenständiges Fan-Projekt'),
      ),
    );
  }

  setReady(): void {
    this.startButton.disabled = false;
    this.status.classList.add('hidden');
    this.startButton.focus();
  }

  setProgress(text: string): void {
    this.statusText.textContent = text;
  }

  setAttribution(text: string): void {
    this.attribution.textContent = text;
  }

  setError(message: string): void {
    this.status.replaceChildren(h('span', { class: 'error' }, message));
  }
}
