import { safeJson, safeStringify } from '../safeJson';

describe('safeJson', () => {
    it('handles circular references', () => {
        const obj: any = { a: 1 };
        obj.self = obj;

        const result = safeJson(obj);
        expect(result).toEqual({ a: 1, self: '[Circular]' });
    });

    it('handles errors', () => {
        const err = new Error('test error');
        const result = safeJson(err);

        expect(result).toEqual({
            name: 'Error',
            message: 'test error',
            stack: expect.any(String),
        });
    });

    it('handles null and undefined', () => {
        expect(safeJson(null)).toBe(null);
        expect(safeJson(undefined)).toBe(undefined);
    });

    it('handles primitives', () => {
        expect(safeJson('string')).toBe('string');
        expect(safeJson(123)).toBe(123);
        expect(safeJson(true)).toBe(true);
    });

    it('handles arrays', () => {
        const arr = [1, { a: 2 }, null];
        const result = safeJson(arr);
        expect(result).toEqual([1, { a: 2 }, null]);
    });

    it('handles nested circular references', () => {
        const obj: any = { a: { b: 1 } };
        obj.a.parent = obj;

        const result = safeJson(obj);
        expect(result).toEqual({
            a: {
                b: 1,
                parent: '[Circular]',
            },
        });
    });
});

describe('safeStringify', () => {
    it('handles circular references', () => {
        const obj: any = { a: 1 };
        obj.self = obj;

        const result = safeStringify(obj, 2);
        expect(result).toBe('{\n  "a": 1,\n  "self": "[Circular]"\n}');
    });

    it('handles errors', () => {
        const err = new Error('test error');
        const result = safeStringify(err);

        expect(result).toContain('"name":"Error"');
        expect(result).toContain('"message":"test error"');
    });

    it('handles null and undefined', () => {
        expect(safeStringify(null)).toBe('null');
        expect(safeStringify(undefined)).toBe(undefined);
    });

    it('handles primitives', () => {
        expect(safeStringify('string')).toBe('"string"');
        expect(safeStringify(123)).toBe('123');
        expect(safeStringify(true)).toBe('true');
    });

    it('handles arrays', () => {
        const arr = [1, { a: 2 }, null];
        const result = safeStringify(arr, 2);
        expect(result).toBe('[\n  1,\n  {\n    "a": 2\n  },\n  null\n]');
    });

    it('handles non-serializable objects', () => {
        const obj = {
            func: () => {},
            symbol: Symbol('test'),
            date: new Date('2023-01-01'),
            regex: /test/g,
        };

        const result = safeStringify(obj);
        expect(result).toContain('"func":"[Non-serializable]"');
        expect(result).toContain('"symbol":"[Non-serializable]"');
        expect(result).toContain('"date":{}');
        expect(result).toContain('"regex":{}');
    });
});
