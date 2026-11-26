import './ui/styles.css';
import { Game } from './core/Game';

function showFatal(message: string): void {
  const root = document.getElementById('ui-root');
  if (!root) return;
  root.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'screen pause-screen';
  box.innerHTML = `<div class="panel"><h2>Fehler</h2><p></p></div>`;
  box.querySelector('p')!.textContent = message;
  root.append(box);
}

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const uiRoot = document.getElementById('ui-root');

if (!canvas || !uiRoot) {
  throw new Error('Missing #game-canvas or #ui-root in index.html');
}

try {
  const game = new Game(canvas, uiRoot);
  void game.init();
  if (import.meta.env.DEV) {
    // Debug/profiling hooks for automated browser tests (dev server only).
    (window as unknown as { game: Game }).game = game;
    void import('three').then((three) => ((window as unknown as { __THREE: unknown }).__THREE = three));
  }
} catch (err) {
  console.error(err);
  showFatal('WebGL konnte nicht gestartet werden. Bitte einen aktuellen Desktop-Browser mit aktivierter Hardwarebeschleunigung verwenden.');
}
