import type { GraphicsQuality, SettingsStore, ShadowQuality, TimeOfDay } from '../../core/Settings';
import { h } from '../dom';
import { CINE_PRESETS, type CinePreset, type CineValues } from '../../rendering/cinematic/CinematicSettings';

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
      segmented<GraphicsQuality>('Qualität (AO, Grading, 2K-Texturen*)', [['low', 'Aus'], ['medium', 'Mittel'], ['high', 'Hoch']], v.graphicsQuality, (q) => settings.update({ graphicsQuality: q })),
      segmented<TimeOfDay>('Tageszeit', [['day', 'Tag'], ['night', 'Nacht']], v.timeOfDay, (t) => settings.update({ timeOfDay: t })),
      segmented<ShadowQuality>('Schatten', [['off', 'Aus'], ['low', 'Mittel'], ['high', 'Hoch']], v.shadowQuality, (q) => settings.update({ shadowQuality: q })),
      range('Renderauflösung', 0.5, 1, 0.05, v.renderScale, (n) => `${Math.round(n * 100)} %`, (n) => settings.update({ renderScale: n })),
      range('Sichtfeld (FOV)', 50, 90, 1, v.fov, (n) => `${n}°`, (n) => settings.update({ fov: n })),
      h('p', { class: 'setting-note' }, '* Texturauflösung wird beim nächsten Spielstart übernommen.'),
      toggle('Leistungsanzeige (F3)', v.showDebug, (b) => settings.update({ showDebug: b })),
      cinematicSection(settings, segmented, toggle),
      h('div', { class: 'panel-actions' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: onBack }, 'Zurück')),
    );
  }
}

/**
 * "Kamera & Look": preset selector, master switch, before/after compare, performance mode and
 * one slider per effect. Every change is applied live (uniform updates, no reload).
 */
function cinematicSection(
  settings: SettingsStore,
  segmented: <T extends string>(label: string, options: [T, string][], value: T, apply: (v: T) => void) => HTMLElement,
  toggle: (label: string, value: boolean, apply: (b: boolean) => void) => HTMLElement,
): HTMLElement {
  const v = settings.values;
  const sliders = new Map<keyof CineValues, { input: HTMLInputElement; out: HTMLElement }>();
  const slider = (key: keyof CineValues, label: string) => {
    const pct = (n: number) => `${Math.round(n * 100)} %`;
    const out = h('output', {}, pct(v.cine[key]));
    const input = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: v.cine[key] }) as HTMLInputElement;
    input.addEventListener('input', () => {
      const n = Number(input.value);
      out.textContent = pct(n);
      settings.update({ cine: { ...settings.values.cine, [key]: n } });
    });
    sliders.set(key, { input, out });
    return h('label', { class: 'setting' }, h('span', {}, label), h('div', { class: 'setting-control' }, input, out));
  };
  const presetOptions = (Object.keys(CINE_PRESETS) as CinePreset[]).map((id) => [id, CINE_PRESETS[id].label.replace('Realistic ', '').replace(' Gameplay', '').replace(' Cinematic', '')] as [CinePreset, string]);
  const details = h(
    'div',
    { class: 'cine-sliders' },
    slider('mist', 'Pro-Mist (Diffusion)'),
    slider('bloom', 'Bloom'),
    slider('chroma', 'Chromatische Aberration'),
    slider('grain', 'Filmkorn'),
    slider('vignette', 'Vignette'),
    slider('grade', 'Color Grading'),
    slider('distortion', 'Objektiv-Verzeichnung'),
  );
  return h(
    'div',
    { class: 'cine-section' },
    h('h3', {}, 'Kamera & Look'),
    toggle('Kamera-Effekte', v.cineEnabled, (b) => settings.update({ cineEnabled: b })),
    segmented<CinePreset>('Preset', presetOptions, v.cinePreset, (id) => {
      const values = { ...CINE_PRESETS[id].values };
      settings.update({ cinePreset: id, cine: values });
      for (const [key, s] of sliders) {
        s.input.value = String(values[key]);
        s.out.textContent = `${Math.round(values[key] * 100)} %`;
      }
    }),
    details,
    toggle('Vorher/Nachher (geteilter Bildschirm)', v.cineCompare, (b) => settings.update({ cineCompare: b })),
    toggle('Performance-Modus (ohne Glow/Aberration)', v.cinePerformance === true, (b) => settings.update({ cinePerformance: b })),
    h('p', { class: 'setting-note' }, 'Effekte benötigen Grafikqualität „Mittel“ oder „Hoch“.'),
  );
}
