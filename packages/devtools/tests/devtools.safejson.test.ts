import { CNS } from '@cnstra/core';
import { CNSDevTools } from '../src';
import { FakeTransport } from './fakeTransport';

describe('CNSDevTools safeJson', () => {
    it('handles circular structures and errors', () => {
        const cns = new CNS<any, any, any, any>([]);
        const transport = new FakeTransport();
        const devtools = new CNSDevTools(cns as any, transport as any, {
            devToolsInstanceId: 'test-app',
            devToolsInstanceName: 'Test App',
        });
        const obj: any = { a: 1 };
        obj.self = obj;
        const result = (devtools as any).safeJson(obj);
        expect(result).toEqual({ a: 1, self: '[Circular]' });

        const err = new Error('boom');
        const res = (devtools as any).safeJson(err);
        expect((res as any).message).toBe('boom');
    });
});
