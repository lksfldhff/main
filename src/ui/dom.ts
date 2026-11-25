type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

/** Tiny hyperscript helper for building UI without a framework. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = String(value);
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    el.append(child);
  }
  return el;
}

export function keycap(label: string): HTMLElement {
  return h('kbd', { class: 'keycap' }, label);
}
