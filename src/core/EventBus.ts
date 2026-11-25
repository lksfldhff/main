/** Minimal typed pub/sub used to decouple gameplay from UI. */
export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => set!.delete(handler as (payload: never) => void);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.handlers.get(event)?.forEach((h) => (h as (p: Events[K]) => void)(payload));
  }
}

export interface GameEvents extends Record<string, unknown> {
  /** Short on-screen notification. */
  notify: { title: string; text: string };
}
