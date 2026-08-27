/*!
 * ParticleImage – ein Bild, aufgeloest in GPU-Partikel, die auseinanderwirbeln
 * und sich wieder zusammensetzen. Nachbau des "Particle Image"-Effekts
 * (React Bits Pro), von Grund auf neu implementiert, ohne Abhaengigkeiten.
 *
 * Technik:
 *  - Das Bild wird in ein Offscreen-Canvas gezeichnet und per getImageData
 *    auf einem Raster (particleGap) abgetastet. Jeder sichtbare Pixel wird
 *    ein Partikel mit Heimatposition + Farbe.
 *  - Eine kleine Physik-Simulation (Feder Richtung Heimat, Reibung,
 *    Wirbelkraft, Maus-Abstossung) laeuft auf der CPU ueber Typed Arrays.
 *  - Gerendert wird mit WebGL als ein einziger POINTS-Drawcall
 *    (weiche, runde Sprites im Fragment-Shader). Ohne WebGL greift ein
 *    Canvas-2D-Fallback.
 *
 * Lizenz: MIT
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ParticleImage = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TAU = Math.PI * 2;
  var STEP = 1 / 60; // fester Physik-Zeitschritt in Sekunden

  var DEFAULTS = {
    src: null,             // URL, HTMLImageElement oder HTMLCanvasElement
    particleGap: 4,        // Rasterabstand beim Abtasten (CSS-Pixel)
    particleSize: 2,       // Punktdurchmesser (CSS-Pixel)
    alphaThreshold: 24,    // Pixel mit weniger Alpha werden uebersprungen
    maxParticles: 60000,   // Sicherheitsgrenze, Gap wird sonst vergroessert
    fit: 'contain',        // Bild in die Flaeche einpassen
    padding: 24,           // Innenabstand zum Canvas-Rand (CSS-Pixel)

    spring: 0.06,          // Federkraft Richtung Heimatposition
    friction: 0.86,        // Daempfung der Geschwindigkeit (0..1)
    swirl: 1,              // Staerke des Wirbelns (0 = geradlinig)
    scatterRadius: 1.1,    // Streuweite relativ zur Canvas-Diagonale
    jitter: 0.6,           // feines Eigenleben im zusammengesetzten Zustand
    assembleStagger: 0.7,  // zeitliche Staffelung beim Zusammensetzen (s)

    mouseRadius: 110,      // Wirkradius des Zeigers (CSS-Pixel)
    mouseStrength: 9,      // Abstossungskraft des Zeigers
    mouseDrag: 0.12,       // wie stark Zeigerbewegung Partikel "mitreisst"

    autoAssemble: true,    // nach dem Laden automatisch zusammensetzen
    renderer: 'auto',      // 'auto' | 'webgl' | 'canvas2d'
    pixelRatio: 0,         // 0 = devicePixelRatio (auf 2 begrenzt)
    onReady: null          // Callback: onReady({ count, renderer })
  };

  // ---------------------------------------------------------------- Hilfen

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      if (typeof src !== 'string') { resolve(src); return; } // Element direkt
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Bild konnte nicht geladen werden: ' + src)); };
      img.src = src;
    });
  }

  // Deterministischer Zufall, damit ein Resize das Partikelbild nicht "neu wuerfelt"
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------- WebGL-Teil

  var VERT_SRC = [
    'attribute vec2 a_pos;',
    'attribute vec4 a_color;',
    'attribute float a_size;',
    'uniform vec2 u_resolution;',
    'uniform float u_dpr;',
    'varying vec4 v_color;',
    'void main() {',
    '  vec2 clip = (a_pos / u_resolution) * 2.0 - 1.0;',
    '  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);',
    '  gl_PointSize = max(a_size * u_dpr, 1.0);',
    '  v_color = a_color;',
    '}'
  ].join('\n');

  var FRAG_SRC = [
    'precision mediump float;',
    'varying vec4 v_color;',
    'void main() {',
    '  vec2 p = gl_PointCoord - 0.5;',
    '  float d = length(p);',
    '  float mask = smoothstep(0.5, 0.32, d);', // weicher, runder Punkt
    '  if (mask <= 0.003) discard;',
    '  gl_FragColor = vec4(v_color.rgb, v_color.a * mask);',
    '}'
  ].join('\n');

  function compileShader(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Shader-Fehler: ' + log);
    }
    return sh;
  }

  function GlRenderer(canvas) {
    var gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false })
          || canvas.getContext('experimental-webgl', { alpha: true, antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL nicht verfuegbar');
    this.gl = gl;

    var vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    var fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Programm-Fehler: ' + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);
    this.prog = prog;

    this.locPos = gl.getAttribLocation(prog, 'a_pos');
    this.locColor = gl.getAttribLocation(prog, 'a_color');
    this.locSize = gl.getAttribLocation(prog, 'a_size');
    this.uResolution = gl.getUniformLocation(prog, 'u_resolution');
    this.uDpr = gl.getUniformLocation(prog, 'u_dpr');

    this.bufPos = gl.createBuffer();
    this.bufColor = gl.createBuffer();
    this.bufSize = gl.createBuffer();

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    this.count = 0;
  }

  GlRenderer.prototype.upload = function (pos, color, size, count) {
    var gl = this.gl;
    this.count = count;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.locPos);
    gl.vertexAttribPointer(this.locPos, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufColor);
    gl.bufferData(gl.ARRAY_BUFFER, color, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.locColor);
    gl.vertexAttribPointer(this.locColor, 4, gl.UNSIGNED_BYTE, true, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSize);
    gl.bufferData(gl.ARRAY_BUFFER, size, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.locSize);
    gl.vertexAttribPointer(this.locSize, 1, gl.FLOAT, false, 0, 0);
  };

  GlRenderer.prototype.render = function (pos, cssW, cssH, dpr) {
    var gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform2f(this.uResolution, cssW, cssH);
    gl.uniform1f(this.uDpr, dpr);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
    gl.drawArrays(gl.POINTS, 0, this.count);
  };

  GlRenderer.prototype.dispose = function () {
    var gl = this.gl;
    gl.deleteBuffer(this.bufPos);
    gl.deleteBuffer(this.bufColor);
    gl.deleteBuffer(this.bufSize);
    gl.deleteProgram(this.prog);
  };

  // --------------------------------------------------------- Canvas2D-Teil

  function Canvas2dRenderer(canvas) {
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('2D-Kontext nicht verfuegbar');
    this.count = 0;
    this.styles = null;
    this.size = null;
  }

  Canvas2dRenderer.prototype.upload = function (pos, color, size, count) {
    this.count = count;
    this.size = size;
    // Farb-Strings einmalig vorberechnen (rgba() im Renderloop waere zu teuer)
    this.styles = new Array(count);
    for (var i = 0; i < count; i++) {
      var o = i * 4;
      this.styles[i] = 'rgba(' + color[o] + ',' + color[o + 1] + ',' +
        color[o + 2] + ',' + (color[o + 3] / 255).toFixed(3) + ')';
    }
  };

  Canvas2dRenderer.prototype.render = function (pos, cssW, cssH, dpr) {
    var ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    for (var i = 0; i < this.count; i++) {
      var s = this.size[i];
      ctx.fillStyle = this.styles[i];
      ctx.fillRect(pos[i * 2] - s / 2, pos[i * 2 + 1] - s / 2, s, s);
    }
  };

  Canvas2dRenderer.prototype.dispose = function () {};

  // ------------------------------------------------------------ Hauptklasse

  function ParticleImage(canvas, options) {
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new Error('ParticleImage: erstes Argument muss ein <canvas> sein');
    }
    this.canvas = canvas;
    this.opts = Object.assign({}, DEFAULTS, options || {});
    if (!this.opts.src) throw new Error('ParticleImage: Option "src" fehlt');

    this.count = 0;
    this.home = null;   // Float32Array 2N – Heimatpositionen
    this.pos = null;    // Float32Array 2N – aktuelle Positionen
    this.vel = null;    // Float32Array 2N – Geschwindigkeiten
    this.seed = null;   // Float32Array  N – Zufallswert je Partikel
    this.scatter = null;// Float32Array 2N – Streuziele im aufgeloesten Zustand
    this.color = null;  // Uint8Array   4N
    this.sizes = null;  // Float32Array  N

    this.mode = 'scattered';   // 'scattered' | 'assembling' | 'assembled' | 'dissolving'
    this.modeTime = 0;         // Sekunden seit letztem Moduswechsel
    this.time = 0;
    this._acc = 0;
    this._last = 0;
    this._raf = 0;
    this._destroyed = false;
    this._img = null;

    this.mouse = { x: 0, y: 0, vx: 0, vy: 0, active: false, tx: 0, ty: 0 };

    this.cssW = 0;
    this.cssH = 0;
    this.dpr = 1;

    this._initRenderer();
    this._bindEvents();

    var self = this;
    this._ready = loadImage(this.opts.src).then(function (img) {
      if (self._destroyed) return self;
      self._img = img;
      self._measure();
      self._buildParticles(true);
      if (self.opts.autoAssemble) self.assemble();
      if (typeof self.opts.onReady === 'function') {
        self.opts.onReady({ count: self.count, renderer: self.rendererName });
      }
      return self;
    });

    this._last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  ParticleImage.prototype.ready = function () { return this._ready; };

  ParticleImage.prototype._initRenderer = function () {
    var want = this.opts.renderer;
    this.renderer = null;
    if (want === 'auto' || want === 'webgl') {
      try {
        this.renderer = new GlRenderer(this.canvas);
        this.rendererName = 'webgl';
      } catch (e) {
        if (want === 'webgl') throw e;
      }
    }
    if (!this.renderer) {
      this.renderer = new Canvas2dRenderer(this.canvas);
      this.rendererName = 'canvas2d';
    }
  };

  ParticleImage.prototype._bindEvents = function () {
    var self = this;
    var el = this.canvas;

    this._onMove = function (ev) {
      var r = el.getBoundingClientRect();
      self.mouse.tx = ev.clientX - r.left;
      self.mouse.ty = ev.clientY - r.top;
      if (!self.mouse.active) { // beim Eintritt nicht quer durchs Bild "reissen"
        self.mouse.x = self.mouse.tx;
        self.mouse.y = self.mouse.ty;
      }
      self.mouse.active = true;
    };
    this._onLeave = function () { self.mouse.active = false; };
    this._onDown = function (ev) {
      var r = el.getBoundingClientRect();
      self.burst(ev.clientX - r.left, ev.clientY - r.top);
    };

    el.addEventListener('pointermove', this._onMove);
    el.addEventListener('pointerdown', this._onDown);
    el.addEventListener('pointerleave', this._onLeave);

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(function () { self.resize(); });
      this._ro.observe(el);
    } else {
      this._onWinResize = function () { self.resize(); };
      window.addEventListener('resize', this._onWinResize);
    }
  };

  ParticleImage.prototype._measure = function () {
    var el = this.canvas;
    var w = el.clientWidth || el.width || 300;
    var h = el.clientHeight || el.height || 150;
    var dpr = this.opts.pixelRatio || Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    var bw = Math.max(1, Math.round(w * dpr));
    var bh = Math.max(1, Math.round(h * dpr));
    if (el.width !== bw) el.width = bw;
    if (el.height !== bh) el.height = bh;
  };

  // Bild einpassen, abtasten und alle Partikel-Puffer (neu) aufbauen
  ParticleImage.prototype._buildParticles = function (startScattered) {
    var img = this._img;
    if (!img) return;

    var iw = img.naturalWidth || img.videoWidth || img.width;
    var ih = img.naturalHeight || img.videoHeight || img.height;
    if (!iw || !ih || !this.cssW || !this.cssH) return;

    var pad = this.opts.padding;
    var availW = Math.max(8, this.cssW - pad * 2);
    var availH = Math.max(8, this.cssH - pad * 2);
    var scale = Math.min(availW / iw, availH / ih);
    var fw = Math.max(1, Math.round(iw * scale));
    var fh = Math.max(1, Math.round(ih * scale));
    var fx = (this.cssW - fw) / 2;
    var fy = (this.cssH - fh) / 2;

    // Abtast-Canvas in Zielgroesse (CSS-Pixel), damit "gap" dort direkt gilt
    var sc = this._sampleCanvas || (this._sampleCanvas = document.createElement('canvas'));
    sc.width = fw;
    sc.height = fh;
    var sctx = sc.getContext('2d', { willReadFrequently: true });
    sctx.clearRect(0, 0, fw, fh);
    sctx.drawImage(img, 0, 0, fw, fh);

    var data;
    try {
      data = sctx.getImageData(0, 0, fw, fh).data;
    } catch (e) {
      throw new Error('Pixel nicht lesbar (CORS?). Bild von gleicher Herkunft oder mit CORS-Headern laden. ' + e.message);
    }

    // Gap ggf. erhoehen, bis wir unter maxParticles bleiben
    var gap = Math.max(1, Math.round(this.opts.particleGap));
    var threshold = this.opts.alphaThreshold;
    var count;
    for (;;) {
      count = 0;
      for (var y = Math.floor(gap / 2); y < fh; y += gap) {
        for (var x = Math.floor(gap / 2); x < fw; x += gap) {
          if (data[(y * fw + x) * 4 + 3] >= threshold) count++;
        }
      }
      if (count <= this.opts.maxParticles || gap > 64) break;
      gap++;
    }
    this.effectiveGap = gap;

    var home = new Float32Array(count * 2);
    var color = new Uint8Array(count * 4);
    var seed = new Float32Array(count);
    var sizes = new Float32Array(count);
    var scatter = new Float32Array(count * 2);
    var pos = new Float32Array(count * 2);
    var vel = new Float32Array(count * 2);

    var rnd = mulberry32(0xC0FFEE);
    var diag = Math.sqrt(this.cssW * this.cssW + this.cssH * this.cssH);
    var scatterR = diag * 0.5 * this.opts.scatterRadius;
    var cx = this.cssW / 2;
    var cy = this.cssH / 2;
    var baseSize = this.opts.particleSize;

    var i = 0;
    for (var yy = Math.floor(gap / 2); yy < fh; yy += gap) {
      for (var xx = Math.floor(gap / 2); xx < fw; xx += gap) {
        var o = (yy * fw + xx) * 4;
        if (data[o + 3] < threshold) continue;
        var s = rnd();
        var i2 = i * 2;
        home[i2] = fx + xx;
        home[i2 + 1] = fy + yy;
        color[i * 4] = data[o];
        color[i * 4 + 1] = data[o + 1];
        color[i * 4 + 2] = data[o + 2];
        color[i * 4 + 3] = data[o + 3];
        seed[i] = s;
        sizes[i] = baseSize * (0.7 + s * 0.7); // leichte Groessenvariation

        // Streuziel: Ring um die Mitte, Winkel/Radius aus dem Seed
        var ang = s * TAU;
        var rad = scatterR * (0.55 + rnd() * 0.75);
        scatter[i2] = cx + Math.cos(ang) * rad;
        scatter[i2 + 1] = cy + Math.sin(ang) * rad;
        i++;
      }
    }

    // Startzustand: entweder verstreut (Intro) oder direkt an der Heimat
    var oldCount = this.count;
    for (var k = 0; k < count; k++) {
      var k2 = k * 2;
      if (startScattered || this.mode === 'scattered' || this.mode === 'dissolving') {
        pos[k2] = scatter[k2];
        pos[k2 + 1] = scatter[k2 + 1];
      } else if (oldCount && this.pos && k < oldCount) {
        pos[k2] = this.pos[k2]; // Resize: Bewegung weich fortsetzen
        pos[k2 + 1] = this.pos[k2 + 1];
      } else {
        pos[k2] = home[k2];
        pos[k2 + 1] = home[k2 + 1];
      }
    }

    this.count = count;
    this.home = home;
    this.pos = pos;
    this.vel = vel;
    this.seed = seed;
    this.color = color;
    this.sizes = sizes;
    this.scatterTargets = scatter;

    this.renderer.upload(pos, color, sizes, count);
  };

  // ------------------------------------------------------------- Steuerung

  ParticleImage.prototype.assemble = function () {
    if (!this.count) { this.mode = 'assembling'; this.modeTime = 0; return; }
    this.mode = 'assembling';
    this.modeTime = 0;
  };

  ParticleImage.prototype.dissolve = function () {
    this.mode = 'dissolving';
    this.modeTime = 0;
    // Anfangsimpuls nach aussen, damit das Bild sichtbar "zerplatzt"
    var cx = this.cssW / 2, cy = this.cssH / 2;
    for (var i = 0; i < this.count; i++) {
      var i2 = i * 2;
      var dx = this.pos[i2] - cx;
      var dy = this.pos[i2 + 1] - cy;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var kick = 2.5 + this.seed[i] * 5;
      this.vel[i2] += (dx / d) * kick;
      this.vel[i2 + 1] += (dy / d) * kick;
    }
  };

  ParticleImage.prototype.toggle = function () {
    if (this.mode === 'assembling' || this.mode === 'assembled') this.dissolve();
    else this.assemble();
  };

  ParticleImage.prototype.isAssembled = function () {
    return this.mode === 'assembling' || this.mode === 'assembled';
  };

  // Druckwelle, z. B. bei Klick
  ParticleImage.prototype.burst = function (x, y, strength) {
    var R = (this.opts.mouseRadius || 100) * 1.8;
    var S = (strength == null ? this.opts.mouseStrength : strength) * 1.6;
    for (var i = 0; i < this.count; i++) {
      var i2 = i * 2;
      var dx = this.pos[i2] - x;
      var dy = this.pos[i2 + 1] - y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d >= R || d === 0) continue;
      var f = (1 - d / R);
      f = f * f * S;
      this.vel[i2] += (dx / d) * f;
      this.vel[i2 + 1] += (dy / d) * f;
    }
  };

  ParticleImage.prototype.setImage = function (src) {
    var self = this;
    this.opts.src = src;
    return loadImage(src).then(function (img) {
      if (self._destroyed) return self;
      self._img = img;
      self._measure();
      self._buildParticles(true);
      self.assemble();
      return self;
    });
  };

  ParticleImage.prototype.setOptions = function (partial) {
    var rebuild = false;
    for (var k in partial) {
      if (!Object.prototype.hasOwnProperty.call(partial, k)) continue;
      this.opts[k] = partial[k];
      if (k === 'particleGap' || k === 'particleSize' || k === 'alphaThreshold' ||
          k === 'padding' || k === 'maxParticles' || k === 'scatterRadius') rebuild = true;
    }
    if (rebuild && this._img) {
      var wasAssembled = this.isAssembled();
      this._buildParticles(!wasAssembled);
      if (wasAssembled) this.mode = 'assembling';
    }
  };

  ParticleImage.prototype.resize = function () {
    if (this._destroyed) return;
    var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w === this.cssW && h === this.cssH && this.canvas.width) return;
    this._measure();
    if (this._img) this._buildParticles(false);
  };

  ParticleImage.prototype.destroy = function () {
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    var el = this.canvas;
    el.removeEventListener('pointermove', this._onMove);
    el.removeEventListener('pointerdown', this._onDown);
    el.removeEventListener('pointerleave', this._onLeave);
    if (this._ro) this._ro.disconnect();
    if (this._onWinResize) window.removeEventListener('resize', this._onWinResize);
    if (this.renderer) this.renderer.dispose();
  };

  // -------------------------------------------------------------- Simulation

  ParticleImage.prototype._step = function () {
    var o = this.opts;
    var n = this.count;
    if (!n) return;

    var pos = this.pos, vel = this.vel, home = this.home,
        seed = this.seed, scatter = this.scatterTargets;

    var friction = clamp(o.friction, 0.5, 0.995);
    var spring = o.spring;
    var swirl = o.swirl;
    var t = this.time;
    var mt = this.modeTime;
    var stagger = Math.max(0.0001, o.assembleStagger);

    var assembling = this.mode === 'assembling' || this.mode === 'assembled';

    // Maus glaetten + Zeigergeschwindigkeit fuer den "Mitreiss"-Effekt
    var m = this.mouse;
    var mx = m.x, my = m.y;
    if (m.active) {
      var nx = mx + (m.tx - mx) * 0.35;
      var ny = my + (m.ty - my) * 0.35;
      m.vx = nx - mx; m.vy = ny - my;
      m.x = nx; m.y = ny;
      mx = nx; my = ny;
    } else {
      m.vx *= 0.9; m.vy *= 0.9;
    }
    var mR = o.mouseRadius;
    var mR2 = mR * mR;
    var mS = o.mouseStrength;
    var mDrag = o.mouseDrag;
    var mouseOn = m.active && mR > 0 && mS !== 0;

    var cx = this.cssW / 2, cy = this.cssH / 2;
    var jitterAmp = o.jitter * 0.05;

    for (var i = 0; i < n; i++) {
      var i2 = i * 2;
      var px = pos[i2], py = pos[i2 + 1];
      var fx = 0, fy = 0;
      var s = seed[i];

      if (assembling && mt >= s * stagger) {
        // Feder zur Heimat. Fuer den Wirbel wird der Federvektor um einen
        // Winkel gedreht -> die Partikel fliegen in Spiralen statt auf
        // Geraden ein. Eine dauerhaft rotierte Feder waere im diskreten
        // Zeitschritt instabil, deshalb klingt der Winkel je Partikel ueber
        // die ersten ~1.6 s ab: erst Spirale, dann reine (stabile) Feder.
        var hx = home[i2] - px;
        var hy = home[i2 + 1] - py;
        var sfx = hx * spring;
        var sfy = hy * spring;
        if (swirl) {
          var env = 1 - (mt - s * stagger) / 1.6;
          var dist = Math.sqrt(hx * hx + hy * hy);
          if (env > 0 && dist > 2) {
            var side = s < 0.5 ? 1 : -1;
            var angle = side * swirl * 0.9 * Math.min(dist / 300, 1) * env;
            angle = clamp(angle, -1.1, 1.1);
            var ca = Math.cos(angle), sa = Math.sin(angle);
            var rfx = sfx * ca - sfy * sa;
            sfy = sfx * sa + sfy * ca;
            sfx = rfx;
          }
        }
        fx += sfx;
        fy += sfy;
        // feines Eigenleben, wenn das Bild steht
        if (jitterAmp) {
          fx += Math.sin(t * 2.1 + s * 37.0) * jitterAmp;
          fy += Math.cos(t * 1.7 + s * 53.0) * jitterAmp;
        }
      } else {
        // Aufgeloester Zustand: lose ans Streuziel gebunden und um die
        // Mitte kreisend -> die Wolke wirbelt, statt still zu stehen.
        var sxv = scatter[i2] - px;
        var syv = scatter[i2 + 1] - py;
        fx += sxv * 0.0018;
        fy += syv * 0.0018;

        var rx = px - cx, ry = py - cy;
        var rd = Math.sqrt(rx * rx + ry * ry) || 1;
        var orbit = 0.05 * swirl * (0.5 + s);
        fx += (-ry / rd) * orbit;
        fy += (rx / rd) * orbit;
        // langsames Atmen der Wolke
        fx += (rx / rd) * Math.sin(t * 0.8 + s * TAU) * 0.02;
        fy += (ry / rd) * Math.sin(t * 0.8 + s * TAU) * 0.02;
      }

      if (mouseOn) {
        var dxm = px - mx;
        var dym = py - my;
        var d2 = dxm * dxm + dym * dym;
        if (d2 < mR2 && d2 > 0.0001) {
          var d = Math.sqrt(d2);
          var fall = 1 - d / mR;
          var rep = fall * fall * mS;
          fx += (dxm / d) * rep;
          fy += (dym / d) * rep;
          // Zeigerbewegung reisst Partikel ein Stueck mit
          fx += m.vx * mDrag * fall;
          fy += m.vy * mDrag * fall;
        }
      }

      var vx = (vel[i2] + fx) * friction;
      var vy = (vel[i2 + 1] + fy) * friction;
      // Sicherheitsnetz: Tempolimit haelt die Simulation auch bei extremen
      // Einstellungen (hoher spring/mouseStrength) numerisch stabil.
      var sp2 = vx * vx + vy * vy;
      if (sp2 > 2304) { // 48 px pro Schritt
        var k = 48 / Math.sqrt(sp2);
        vx *= k;
        vy *= k;
      }
      vel[i2] = vx;
      vel[i2 + 1] = vy;
      pos[i2] = px + vx;
      pos[i2 + 1] = py + vy;
    }

    // Moduswechsel: nach dem Einschwingen gilt das Bild als "steht"
    if (this.mode === 'assembling' && mt > stagger + 2.5) this.mode = 'assembled';
    if (this.mode === 'dissolving' && mt > 2.5) this.mode = 'scattered';
  };

  ParticleImage.prototype._loop = function (now) {
    if (this._destroyed) return;
    this._raf = requestAnimationFrame(this._loop);

    var dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.25) dt = 0.25; // Tab war im Hintergrund

    this._acc += dt;
    var steps = 0;
    while (this._acc >= STEP && steps < 4) {
      this.time += STEP;
      this.modeTime += STEP;
      this._step();
      this._acc -= STEP;
      steps++;
    }
    if (steps === 4) this._acc = 0; // nicht aufschaukeln

    if (this.count) this.renderer.render(this.pos, this.cssW, this.cssH, this.dpr);
  };

  ParticleImage.DEFAULTS = DEFAULTS;
  return ParticleImage;
});
