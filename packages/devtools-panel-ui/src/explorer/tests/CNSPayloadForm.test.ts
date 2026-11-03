import { CNSPayloadForm } from '../CNSPayloadForm';

const schema = {
    type: 'object',
    properties: {
        userId: { type: 'string' },
        kind: { type: 'string', enum: ['reminder', 'digest'] },
        count: { type: 'integer' },
        urgent: { type: 'boolean' },
    },
    required: ['userId', 'count'],
};

describe('CNSPayloadForm', () => {
    it('builds fields for an object of primitive properties and leaves any other schema to raw JSON', () => {
        expect(CNSPayloadForm.fieldsOf(schema)).toEqual([
            { name: 'userId', kind: 'string', required: true },
            { name: 'kind', kind: 'string', required: false, options: ['reminder', 'digest'] },
            { name: 'count', kind: 'integer', required: true },
            { name: 'urgent', kind: 'boolean', required: false },
        ]);
        expect(CNSPayloadForm.fieldsOf({ type: 'object', properties: { items: { type: 'array' } } })).toBeUndefined();
        expect(CNSPayloadForm.fieldsOf(undefined)).toBeUndefined();
    });

    it('turns the typed values into a payload, skipping empty optional fields and refusing bad ones', () => {
        const fields = CNSPayloadForm.fieldsOf(schema) ?? [];

        expect(CNSPayloadForm.payloadOf(fields, { userId: ' u1 ', count: '3', urgent: true })).toEqual({
            payload: { userId: 'u1', count: 3, urgent: true },
        });
        expect(CNSPayloadForm.payloadOf(fields, { count: '3' })).toEqual({ error: '"userId" is required' });
        expect(CNSPayloadForm.payloadOf(fields, { userId: 'u1', count: '2.5' })).toEqual({ error: '"count" must be an integer' });
        expect(CNSPayloadForm.jsonPayloadOf('{"a":1}')).toEqual({ payload: { a: 1 } });
        expect('error' in CNSPayloadForm.jsonPayloadOf('{')).toBe(true);
    });
});
