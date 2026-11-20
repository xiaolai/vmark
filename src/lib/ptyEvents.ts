/**
 * Small synchronous event emitter shared by the PTY wrapper's streams.
 * @module lib/ptyEvents
 */

interface IDisposable { dispose(): void }
export type IEvent<T> = (listener: (data: T) => void) => IDisposable;
export class EventEmitter<T> {
  private listeners: Array<(data: T) => void> = [];
  get event(): IEvent<T> {
    return listener => {
      this.listeners.push(listener);
      return { dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) this.listeners.splice(index, 1);
      } };
    };
  }
  fire(data: T): void { for (const listener of [...this.listeners]) listener(data); }
}
