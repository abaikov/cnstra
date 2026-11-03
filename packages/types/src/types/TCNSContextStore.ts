/**
 * A context store: data attached to something the engine is running, in
 * compartments.
 *
 * There are two of them, same shape, different life — the run's
 * (`stimulationContext`, one per stimulation) and the activation's
 * (`activationContext`, one per neuron activation). Same shape on purpose: they
 * are used the same way, serialized the same way, and read the same way.
 *
 * A key is a namespace its writer owns, by convention the package name
 * (`'@cnstra/persist-otel'`), so an integration and your own code cannot
 * overwrite each other. A caller who owns their whole run does not need a prefix.
 *
 * Plain object with string keys rather than a `Map` because this crosses a
 * process boundary: `JSON.stringify` turns a `Map` into `{}` and drops symbol
 * keys entirely, so neither could carry anything. What is portable travels with
 * the serialized frontier; a live handle stays where it was made.
 */
export type TCNSContextStore = Record<string, unknown>;
