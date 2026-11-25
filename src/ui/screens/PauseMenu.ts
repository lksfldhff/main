import { h } from '../dom';

export interface PauseMenuActions {
  onResume(): void;
  onSettings(): void;
  onRespawn(): void;
  onMainMenu(): void;
}

export class PauseMenu {
  readonly element: HTMLElement;

  constructor(actions: PauseMenuActions) {
    this.element = h(
      'section',
      { class: 'screen pause-screen' },
      h(
        'div',
        { class: 'panel pause-panel' },
        h('h2', {}, 'Pause'),
        h(
          'nav',
          { class: 'menu' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => actions.onResume() }, 'Fortsetzen'),
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => actions.onSettings() }, 'Einstellungen'),
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => actions.onRespawn() }, 'Zum Startpunkt'),
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => actions.onMainMenu() }, 'Hauptmenü'),
        ),
      ),
    );
  }
}
