import { CNS } from '@cnstra/core';

export interface ICNSContextValue {
    cns: CNS<any, any>;
}

export interface ICNSProviderProps {
    cns: CNS<any, any>;
    children: React.ReactNode;
}
