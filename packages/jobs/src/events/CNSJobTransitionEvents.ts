import type { TCNSJobTransition } from '../types/TCNSJobTransition';
import type { CNSJobEventEmitter } from './CNSJobEventEmitter';
import { CNSJobEventNames } from './CNSJobEventNames';

export class CNSJobTransitionEvents {
    static emitFinished(events: CNSJobEventEmitter, transitions: readonly TCNSJobTransition[]): void {
        for (const transition of transitions) {
            if (transition.finalStatus) {
                events.emit({ name: CNSJobEventNames.finished(transition.finalStatus), jobId: transition.jobId, seq: transition.seq, jobType: transition.jobType });
            }
        }
    }
}
