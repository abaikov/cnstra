export type TCNSPayloadField = {
    name: string;
    kind: 'string' | 'number' | 'integer' | 'boolean';
    required: boolean;
    options?: string[];
};
