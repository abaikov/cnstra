import { CNS } from '@cnstra/core';

export interface CNSContextValue {
    cns: CNS<any, any, any, any>;
}

export interface CNSProviderProps {
    cns: CNS<any, any, any, any>;
    children: React.ReactNode;
}
