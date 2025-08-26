import { collateral } from '../src/factory';

describe('CNSCollateral', () => {
    describe('Basic Functionality', () => {
        it('should create collateral with id', () => {
            const testCollateral = collateral('test-collateral');
            expect(testCollateral.id).toBe('test-collateral');
        });

        it('should create signal with payload', () => {
            const testCollateral = collateral<{ message: string }>('test');
            const signal = testCollateral.createSignal({
                message: 'Hello World',
            });

            expect(signal.type).toBe('test');
            expect(signal.payload).toEqual({ message: 'Hello World' });
        });

        it('should create signal without payload when type is undefined', () => {
            const testCollateral = collateral('test');
            const signal = testCollateral.createSignal();

            expect(signal.type).toBe('test');
            expect(signal.payload).toBeUndefined();
        });

        it('should create signal with undefined payload when type is undefined', () => {
            const testCollateral = collateral<undefined>('test');
            const signal = testCollateral.createSignal();

            expect(signal.type).toBe('test');
            expect(signal.payload).toBeUndefined();
        });
    });

    describe('Type Safety', () => {
        it('should enforce payload type constraints', () => {
            const counterCollateral = collateral<{ count: number }>('counter');

            // This should compile and work correctly
            const signal = counterCollateral.createSignal({ count: 42 });
            expect(signal.payload?.count).toBe(42);
        });

        it('should handle complex payload types', () => {
            interface ComplexPayload {
                id: string;
                data: {
                    name: string;
                    age: number;
                };
                tags: string[];
            }

            const complexCollateral = collateral<ComplexPayload>('complex');
            const payload: ComplexPayload = {
                id: '123',
                data: { name: 'John', age: 30 },
                tags: ['user', 'active'],
            };

            const signal = complexCollateral.createSignal(payload);
            expect(signal.payload).toEqual(payload);
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty string id', () => {
            const emptyCollateral = collateral('');
            const signal = emptyCollateral.createSignal();
            expect(signal.type).toBe('');
        });

        it('should handle special characters in id', () => {
            const specialCollateral = collateral('test:collateral:123');
            const signal = specialCollateral.createSignal();
            expect(signal.type).toBe('test:collateral:123');
        });

        it('should handle numeric payload', () => {
            const numericCollateral = collateral<number>('numeric');
            const signal = numericCollateral.createSignal(42);
            expect(signal.payload).toBe(42);
        });

        it('should handle boolean payload', () => {
            const booleanCollateral = collateral<boolean>('boolean');
            const signal = booleanCollateral.createSignal(true);
            expect(signal.payload).toBe(true);
        });

        it('should handle array payload', () => {
            const arrayCollateral = collateral<string[]>('array');
            const signal = arrayCollateral.createSignal(['a', 'b', 'c']);
            expect(signal.payload).toEqual(['a', 'b', 'c']);
        });
    });
});
