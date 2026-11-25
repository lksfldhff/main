import { h } from '../dom';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ARC_LEN = 0.75; // gauge covers 270°
const MAX_KMH = 220;

/** Circular speedometer with digital readout and gear indicator. */
export class Speedometer {
  readonly element: HTMLElement;
  private readonly value: HTMLElement;
  private readonly gear: HTMLElement;
  private readonly arc: SVGCircleElement;
  private readonly circumference: number;
  private lastKmh = -1;

  constructor() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.classList.add('speedo-ring');
    const r = 52;
    this.circumference = 2 * Math.PI * r;
    const track = document.createElementNS(SVG_NS, 'circle');
    const arc = document.createElementNS(SVG_NS, 'circle');
    for (const c of [track, arc]) {
      c.setAttribute('cx', '60');
      c.setAttribute('cy', '60');
      c.setAttribute('r', String(r));
      c.setAttribute('fill', 'none');
      c.setAttribute('transform', 'rotate(135 60 60)');
      svg.append(c);
    }
    track.setAttribute('class', 'speedo-track');
    track.setAttribute('stroke-dasharray', `${this.circumference * ARC_LEN} ${this.circumference}`);
    arc.setAttribute('class', 'speedo-arc');
    this.arc = arc;
    this.value = h('strong', {}, '0');
    this.gear = h('span', { class: 'speedo-gear' }, 'N');
    this.element = h(
      'div',
      { class: 'speedometer hidden' },
      svg,
      h('div', { class: 'speedo-readout' }, this.value, h('small', {}, 'km/h'), this.gear),
    );
  }

  show(visible: boolean): void {
    this.element.classList.toggle('hidden', !visible);
    document.body.classList.toggle('is-driving', visible);
  }

  update(speedMs: number, throttle: number): void {
    const kmh = Math.round(Math.abs(speedMs) * 3.6);
    if (kmh !== this.lastKmh) {
      this.lastKmh = kmh;
      this.value.textContent = String(kmh);
      const f = Math.min(kmh / MAX_KMH, 1) * ARC_LEN;
      this.arc.setAttribute('stroke-dasharray', `${this.circumference * f} ${this.circumference}`);
    }
    this.gear.textContent = speedMs < -0.5 || (throttle < 0 && Math.abs(speedMs) < 1) ? 'R' : kmh < 1 && throttle === 0 ? 'N' : 'D';
  }
}
