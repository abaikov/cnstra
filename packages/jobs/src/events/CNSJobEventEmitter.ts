import type { ECNSJobEventName } from '../types/ECNSJobEventName';
import type { TCNSJobEvent } from '../types/TCNSJobEvent';
import type { TCNSJobEventListener } from '../types/TCNSJobEventListener';

export class CNSJobEventEmitter {
    private readonly listeners = new Map<ECNSJobEventName | '*', Set<TCNSJobEventListener>>();

    constructor(private readonly onListenerError: (error: unknown, event: TCNSJobEvent) => void) {}

    on(name: ECNSJobEventName | '*', listener: TCNSJobEventListener): () => void {
        const listeners = this.listeners.get(name) ?? new Set<TCNSJobEventListener>();
        listeners.add(listener);
        this.listeners.set(name, listeners);
        return () => {
            listeners.delete(listener);
        };
    }

    emit(event: TCNSJobEvent): void {
        for (const listener of [...(this.listeners.get(event.name) ?? []), ...(this.listeners.get('*') ?? [])]) {
            try {
                listener(event);
            } catch (error) {
                this.onListenerError(error, event);
            }
        }
    }
}
