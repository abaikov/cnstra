import type { ICNSDevToolsTransport } from '../src/interfaces/ICNSDevToolsTransport';
import type {
    InitMessage,
    NeuronResponseMessage,
    StimulateCommand,
    StimulateAccepted,
    StimulateRejected,
} from '@cnstra/devtools-dto';

export class FakeTransport implements ICNSDevToolsTransport {
    public inits: InitMessage[] = [];
    public responses: NeuronResponseMessage[] = [];
    public stimulates: StimulateCommand[] = [];
    public accepted: StimulateAccepted[] = [];
    public rejected: StimulateRejected[] = [];

    onStimulateCommand?(handler: (cmd: StimulateCommand) => void): () => void {
        this._handler = handler;
        const unsubscribe = () => {
            this._handler = undefined;
        };
        return unsubscribe;
    }
    private _handler?: (cmd: StimulateCommand) => void;
    setOnStimulate(handler: (cmd: StimulateCommand) => void) {
        this._handler = handler;
    }

    async sendInitMessage(message: InitMessage): Promise<void> {
        this.inits.push(message);
    }

    async sendNeuronResponseMessage(
        message: NeuronResponseMessage
    ): Promise<void> {
        this.responses.push(message);
    }

    async sendStimulateAccepted(msg: StimulateAccepted): Promise<void> {
        this.accepted.push(msg);
    }

    async sendStimulateRejected(msg: StimulateRejected): Promise<void> {
        this.rejected.push(msg);
    }

    triggerStimulate(cmd: StimulateCommand) {
        this.stimulates.push(cmd);
        this._handler?.(cmd);
    }
}
