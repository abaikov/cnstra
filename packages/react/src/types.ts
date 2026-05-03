import { CNS } from '@cnstra/core';

export interface CNSContextValue {
    cns: CNS<any, any>;
}

export interface CNSProviderProps {
    cns: CNS<any, any>;
    children: React.ReactNode;
}
