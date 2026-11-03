export class CNSJobWorkerStoppedError extends Error {
    constructor() {
        super('job worker is stopping');
        this.name = 'AbortError';
    }
}
