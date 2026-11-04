import type { TCNSStimulationTask } from '@cnstra/persist-dto';

export class CNSTaskKey {
    public static of(task: Pick<TCNSStimulationTask, 'stimulationAttemptId' | 'index'>): string {
        return `${task.stimulationAttemptId}:${task.index}`;
    }

    public static stageOf(index: number): number {
        return index + 1;
    }

    public static stimulationIdOfKey(taskKey: string): string {
        const attemptId = taskKey.slice(0, taskKey.lastIndexOf(':'));
        const numberAt = attemptId.lastIndexOf('#');
        return numberAt < 0 ? attemptId : attemptId.slice(0, numberAt);
    }

    public static stageOfKey(taskKey: string): number | null {
        const index = Number(taskKey.slice(taskKey.lastIndexOf(':') + 1));
        return Number.isFinite(index) ? CNSTaskKey.stageOf(index) : null;
    }
}
