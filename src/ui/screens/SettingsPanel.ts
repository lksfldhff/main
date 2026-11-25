import type { GraphicsQuality, SettingsStore, ShadowQuality } from '../../core/Settings';
import { h } from '../dom';

/** Settings form shared by the start screen and the pause menu. */
export class SettingsPanel {
  readonly element: HTMLElement;

  constructor(settings: SettingsStore, onBack: () => void) {
    const v = settings.values;

    const range = (label: string, min: number, max: number, step: number, value: number, format: (n: number) => string, apply: (n: number) => void) => {
      const out = h('output', {}, format(value));
      const input = h('input', { type: 'range', min, max, step, value });
      input.addEventListener('input', () => {
        const n = Number(input.value);
        out.textContent = format(n);
        apply(n);
      });
      return h('label', { class: 'setting' }, h('span', {}, label), h('div', { class: 'setting-control' }, input, out));
    };

    const segmented = <T extends string>(label: string, options: [T, string][], value: T, apply: (v: T) => void) => {
      const group = h('div', { class: 'segmented', role: 'radiogroup' });
      for (const [val, text] of options) {
        const btn = h('button', { type: 'button', class: val === value ? 'active' : '', 'aria-pressed': String(val === value) }, text);
        btn.addEventListener('click', () => {
          group.querySelectorAll('button').forEach((b) => {
            b.classList.remove('active');
            b.setAttribute('aria-pressed', 'false');
          });
          btn.classList.add('active');
          btn.setAttribute('aria-pressed', 'true');
          apply(val);
        });
        group.append(btn);
      }
      return h('div', { class: 'setting' }, h('span', {}, label), group);
    };

    const toggle = (label: string, value: boolean, apply: (b: boolean) => void) => {
      const input = h('input', { type: 'checkbox', checked: value });
      input.addEventListener('change', () => apply(input.checked));
      return h('label', { class: 'setting' }, h('span', {}, label), h('span', { class: 'switch' }, input, h('span', { class: 'switch-track' })));
    };

    this.element = h(
      'div',
      { class: 'panel settings-panel' },
      h('h2', {}, 'Einstellungen'),
      h('h3', {}, 'Steuerung'),
      range('Mausempfindlichkeit', 0.2, 3, 0.05, v.mouseSensitivity, (n) => n.toFixed(2), (n) => settings.update({ mouseSensitivity: n })),
      toggle('Maus-Y invertieren', v.invertY, (b) => settings.update({ invertY: b })),
      h('h3', {}, 'Grafik'),
      segmented<GraphicsQuality>('Effekte (AO, Farbgrading)', [['low', 'Aus'], ['medium', 'Mittel'], ['high', 'Hoch']], v.graphicsQuality, (q) => settings.update({ graphicsQuality: q })),
      segmented<ShadowQuality>('Schatten', [['off', 'Aus'], ['low', 'Mittel'], ['high', 'Hoch']], v.shadowQuality, (q) => settings.update({ shadowQuality: q })),
      range('Renderauflösung', 0.5, 1, 0.05, v.renderScale, (n) => `${Math.round(n * 100)} %`, (n) => settings.update({ renderScale: n })),
      range('Sichtfeld (FOV)', 50, 90, 1, v.fov, (n) => `${n}°`, (n) => settings.update({ fov: n })),
      toggle('Leistungsanzeige (F3)', v.showDebug, (b) => settings.update({ showDebug: b })),
      h('div', { class: 'panel-actions' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: onBack }, 'Zurück')),
    );
  }
}
