import type { TCNSPayloadField } from './types/TCNSPayloadField';
import type { TCNSPayloadFormResult } from './types/TCNSPayloadFormResult';

export class CNSPayloadForm {
    private static readonly KINDS = new Set<TCNSPayloadField['kind']>(['string', 'number', 'integer', 'boolean']);

    static fieldsOf(schema: unknown): TCNSPayloadField[] | undefined {
        if (!CNSPayloadForm.isRecord(schema) || schema.type !== 'object' || !CNSPayloadForm.isRecord(schema.properties)) return undefined;
        const required = Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === 'string') : [];
        const fields: TCNSPayloadField[] = [];
        for (const [name, property] of Object.entries(schema.properties)) {
            if (!CNSPayloadForm.isRecord(property) || !CNSPayloadForm.KINDS.has(property.type as TCNSPayloadField['kind'])) return undefined;
            const field: TCNSPayloadField = { name, kind: property.type as TCNSPayloadField['kind'], required: required.includes(name) };
            if (Array.isArray(property.enum) && property.enum.every(value => typeof value === 'string')) field.options = property.enum as string[];
            fields.push(field);
        }
        return fields;
    }

    static payloadOf(fields: readonly TCNSPayloadField[], values: Readonly<Record<string, string | boolean>>): TCNSPayloadFormResult {
        const payload: Record<string, unknown> = {};
        for (const field of fields) {
            const value = values[field.name];
            if (field.kind === 'boolean') {
                payload[field.name] = value === true;
                continue;
            }
            const text = typeof value === 'string' ? value.trim() : '';
            if (text === '') {
                if (field.required) return { error: `"${field.name}" is required` };
                continue;
            }
            if (field.kind === 'string') {
                payload[field.name] = text;
                continue;
            }
            const number = Number(text);
            if (!Number.isFinite(number) || (field.kind === 'integer' && !Number.isInteger(number))) {
                return { error: `"${field.name}" must be ${field.kind === 'integer' ? 'an integer' : 'a number'}` };
            }
            payload[field.name] = number;
        }
        return { payload };
    }

    static jsonPayloadOf(text: string): TCNSPayloadFormResult {
        try {
            return { payload: JSON.parse(text) };
        } catch (error) {
            return { error: `payload is not JSON: ${(error as Error).message}` };
        }
    }

    private static isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
}
