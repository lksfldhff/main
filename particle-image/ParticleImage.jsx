/**
 * React-Wrapper um die abhaengigkeitsfreie ParticleImage-Engine
 * (siehe ./particle-image.js). Verwendung:
 *
 *   import ParticleImage from './ParticleImage.jsx';
 *
 *   <ParticleImage
 *     src="/logo.png"
 *     particleGap={4}
 *     particleSize={2}
 *     mouseRadius={110}
 *     mouseStrength={9}
 *     friction={0.86}
 *     swirl={1}
 *     style={{ width: '100%', height: 480 }}
 *   />
 *
 * Ueber eine Ref lassen sich die Methoden der Engine aufrufen:
 *
 *   const fx = useRef(null);
 *   <ParticleImage ref={fx} src="/logo.png" />
 *   fx.current.dissolve(); fx.current.assemble(); fx.current.burst(x, y);
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import ParticleImageEngine from './particle-image.js';

// Optionen, die ohne Neuaufbau der Partikel uebernommen werden koennen
const LIVE_OPTIONS = [
  'particleGap', 'particleSize', 'alphaThreshold', 'padding', 'maxParticles',
  'scatterRadius', 'spring', 'friction', 'swirl', 'jitter', 'assembleStagger',
  'mouseRadius', 'mouseStrength', 'mouseDrag',
];

const ParticleImage = forwardRef(function ParticleImage(props, ref) {
  const {
    src,
    className,
    style,
    autoAssemble = true,
    renderer = 'auto',
    onReady,
    ...options
  } = props;

  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Engine einmalig erzeugen (bzw. neu, wenn sich der Renderer aendert)
  useEffect(() => {
    const engine = new ParticleImageEngine(canvasRef.current, {
      ...options,
      src,
      autoAssemble,
      renderer,
      onReady: (info) => onReadyRef.current && onReadyRef.current(info),
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer]);

  // Bildwechsel: Partikel neu abtasten und wieder zusammensetzen
  useEffect(() => {
    const engine = engineRef.current;
    if (engine && engine.opts.src !== src) {
      engine.setImage(src);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Laufende Optionen ohne Remount uebernehmen
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const partial = {};
    for (const key of LIVE_OPTIONS) {
      if (key in props && engine.opts[key] !== props[key]) {
        partial[key] = props[key];
      }
    }
    if (Object.keys(partial).length) engine.setOptions(partial);
  });

  useImperativeHandle(ref, () => ({
    assemble: () => engineRef.current && engineRef.current.assemble(),
    dissolve: () => engineRef.current && engineRef.current.dissolve(),
    toggle: () => engineRef.current && engineRef.current.toggle(),
    burst: (x, y, strength) =>
      engineRef.current && engineRef.current.burst(x, y, strength),
    isAssembled: () =>
      engineRef.current ? engineRef.current.isAssembled() : false,
    engine: () => engineRef.current,
  }), []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: '100%', height: '100%', ...style }}
    />
  );
});

export default ParticleImage;
