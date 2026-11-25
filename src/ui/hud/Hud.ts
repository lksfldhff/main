import { h, keycap } from '../dom';

/** In-game overlay: interaction prompt, notifications, short controls hint. */
export class Hud {
  readonly element: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly promptText: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly hint: HTMLElement;
  private currentPrompt: string | null = null;

  constructor() {
    this.promptText = h('span', {});
    this.prompt = h('div', { class: 'interaction-prompt hidden' }, keycap('E'), this.promptText);
    this.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    this.hint = h(
      'div',
      { class: 'controls-hint' },
      h('span', {}, keycap('W'), keycap('A'), keycap('S'), keycap('D'), ' Bewegen'),
      h('span', {}, keycap('Shift'), ' Rennen'),
      h('span', {}, keycap('Leertaste'), ' Springen'),
      h('span', {}, keycap('Esc'), ' Pause'),
    );
    this.element = h('div', { class: 'hud hidden' }, this.toasts, this.prompt, this.hint);
  }

  show(visible: boolean): void {
    this.element.classList.toggle('hidden', !visible);
    if (visible) {
      this.hint.classList.remove('fade');
      window.setTimeout(() => this.hint.classList.add('fade'), 7000);
    }
  }

  setPrompt(text: string | null): void {
    if (text === this.currentPrompt) return;
    this.currentPrompt = text;
    this.prompt.classList.toggle('hidden', text === null);
    if (text) this.promptText.textContent = text;
  }

  notify(title: string, text: string, durationMs = 6000): void {
    const toast = h('div', { class: 'toast' }, h('strong', {}, title), h('p', {}, text));
    this.toasts.append(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    window.setTimeout(() => {
      toast.classList.remove('visible');
      window.setTimeout(() => toast.remove(), 400);
    }, durationMs);
  }
}
