import {
    InitMessage,
    NeuronResponseMessage,
    StimulateCommand,
    StimulateAccepted,
    StimulateRejected,
    StimulationMessage,
} from '@cnstra/devtools-dto';

export interface ICNSDevToolsTransport {
    sendNeuronResponseMessage(message: NeuronResponseMessage): Promise<void>;
    sendInitMessage(message: InitMessage): Promise<void>;
    sendStimulationMessage?(message: StimulationMessage): Promise<void>;
    onStimulateCommand?(handler: (cmd: StimulateCommand) => void): () => void;
    sendStimulateAccepted?(ack: StimulateAccepted): Promise<void>;
    sendStimulateRejected?(ack: StimulateRejected): Promise<void>;
}
