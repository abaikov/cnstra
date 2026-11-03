import { describe, expect, it } from '@jest/globals';
import { CNSJobQuestionMarkQuery } from '../connection/CNSJobQuestionMarkQuery';

describe('CNSJobQuestionMarkQuery', () => {
    it('turns numbered parameters into question marks in the order they appear, repeating reused ones', () => {
        expect(CNSJobQuestionMarkQuery.convert('SELECT $2::int, $1::text, $2::int', ['a', 2])).toEqual({
            text: 'SELECT ?::int, ?::text, ?::int',
            params: [2, 'a', 2],
        });
    });

    it('escapes question marks that are not parameters', () => {
        expect(CNSJobQuestionMarkQuery.convert(`SELECT attempts ? 'x', $1`, [1])).toEqual({ text: `SELECT attempts \\? 'x', ?`, params: [1] });
    });
});
