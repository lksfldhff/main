/**
 * Logical actions mapped to physical key codes (KeyboardEvent.code).
 * Codes are layout independent, so WASD works on QWERTZ and QWERTY alike.
 */
export type Action =
  | 'forward'
  | 'backward'
  | 'left'
  | 'right'
  | 'jump'
  | 'sprint'
  | 'interact'
  | 'toggleDebug';

export const DEFAULT_BINDINGS: Record<Action, readonly string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  backward: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  interact: ['KeyE'],
  toggleDebug: ['F3'],
};
