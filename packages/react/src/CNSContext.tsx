import React, { createContext, useContext } from 'react';
import { CNS } from '@cnstra/core';
import { ICNSContextValue, ICNSProviderProps } from './types';

const CNSContext = createContext<ICNSContextValue | null>(null);

export function CNSProvider({ cns, children }: ICNSProviderProps) {
    const value: ICNSContextValue = { cns };

    return <CNSContext.Provider value={value}>{children}</CNSContext.Provider>;
}

export function useCNS(): CNS<any, any> {
    const context = useContext(CNSContext);

    if (!context) {
        throw new Error('useCNS must be used within a CNSProvider');
    }

    return context.cns;
}
