import React, { createContext, useContext } from 'react';
import { CNS } from '@cnstra/core';
import { CNSContextValue, CNSProviderProps } from './types';

const CNSContext = createContext<CNSContextValue | null>(null);

export function CNSProvider({ cns, children }: CNSProviderProps) {
    const value: CNSContextValue = { cns };

    return <CNSContext.Provider value={value}>{children}</CNSContext.Provider>;
}

export function useCNS(): CNS<any, any, any, any> {
    const context = useContext(CNSContext);

    if (!context) {
        throw new Error('useCNS must be used within a CNSProvider');
    }

    return context.cns;
}
