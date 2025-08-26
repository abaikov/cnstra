import { expectType } from 'tsd';
import { collateral } from '../src/factory';

// Test collateral function types
expectType<ReturnType<typeof collateral>>(collateral('test'));
expectType<ReturnType<typeof collateral<{ message: string }>>>(
    collateral<{ message: string }>('test')
);

// Test signal types
const testCollateral = collateral<{ message: string }>('test');
const signal = testCollateral.createSignal({ message: 'Hello' });
expectType<{ type: string; payload?: { message: string } }>(signal);
