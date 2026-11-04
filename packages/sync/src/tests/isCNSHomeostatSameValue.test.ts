import { isCNSHomeostatSameValue } from '@cnstra/sync';

describe('isCNSHomeostatSameValue: two answers that are equal as JSON are the same value', () => {
    it('takes fresh plain objects and arrays with equal content as the same', () => {
        expect(isCNSHomeostatSameValue({ total: 2, tags: ['a', 'b'], owner: { id: 'u1' } }, { owner: { id: 'u1' }, tags: ['a', 'b'], total: 2 })).toBe(true);
        expect(isCNSHomeostatSameValue([{ id: 'c1' }], [{ id: 'c1' }])).toBe(true);
        expect(isCNSHomeostatSameValue(undefined, undefined)).toBe(true);
        expect(isCNSHomeostatSameValue(Number.NaN, Number.NaN)).toBe(true);
        expect(isCNSHomeostatSameValue(0, -0)).toBe(true);
    });

    it('tells apart a changed field, a reordered list, a missing key and a key set to undefined', () => {
        expect(isCNSHomeostatSameValue({ total: 2 }, { total: 3 })).toBe(false);
        expect(isCNSHomeostatSameValue(['a', 'b'], ['b', 'a'])).toBe(false);
        expect(isCNSHomeostatSameValue({ a: 1, b: 2 }, { a: 1 })).toBe(false);
        expect(isCNSHomeostatSameValue({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
        expect(isCNSHomeostatSameValue([1], { 0: 1 })).toBe(false);
        expect(isCNSHomeostatSameValue(null, {})).toBe(false);
        expect(isCNSHomeostatSameValue('1', 1)).toBe(false);
    });

    it('compares objects that are not plain by reference only', () => {
        const date = new Date(0);

        expect(isCNSHomeostatSameValue(date, date)).toBe(true);
        expect(isCNSHomeostatSameValue(new Date(0), new Date(0))).toBe(false);
    });
});
