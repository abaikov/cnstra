/**
 * The one payload shape every benchmark signal carries.
 *
 * Fixed on purpose. Payload size and shape change how much a listener copies,
 * how much the persistor writes and how much `JSON.stringify` chews through, so
 * a benchmark that varied it would be measuring the payload rather than the
 * engine. It is small and boring — a couple of primitives, a short array and one
 * level of nesting — which is what a routing signal usually looks like.
 */
export type TCNSBenchPayload = {
    id: number;
    label: string;
    tags: string[];
    nested: { attempt: number; flag: boolean };
};
