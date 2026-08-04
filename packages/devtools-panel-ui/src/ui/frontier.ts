// Pure, framework-free logic for the "live frontier": which neurons/edges are
// about to run (from topology + the last hops), and how a stalled one ages into
// a "stuck" state. Kept side-effect-free so it can be unit-tested without a
// browser or cytoscape. All identity is by NAME, scoped per cns; graph keys are
// built with `nodeKey(cnsId, name)` (cytoscape needs a scalar node id).

import { nodeKey } from '../utils/format';

export interface FrontierData {
    /** nodeKey -> entered-frontier timestamp (ms). */
    neurons: Record<string, number>;
    /** edgeId (`${fromNode}->${toNode}::${label}`) -> entered-frontier timestamp (ms). */
    edges: Record<string, number>;
}

export const EMPTY_FRONTIER: FrontierData = { neurons: {}, edges: {} };

// Minimal structural shapes (subset of the entities we actually read), all by name.
export interface FrontierHop {
    stimulationId: string;
    /** cns this hop ran in (= cnsId). */
    scopeName: string;
    neuronName: string;
    outputCollateralName?: string | null;
    startedAt?: number;
}
export interface FrontierStimulation {
    stimulationId: string;
    completedAt?: number | null;
    startedAt?: number;
}
export interface FrontierDendrite {
    cnsId: string;
    /** Subscriber neuron. */
    neuronName: string;
    /** Subscribed collateral. */
    collateralName: string;
}
export interface FrontierCollateral {
    cnsId: string;
    name: string;
    /** Owner (emitting) neuron; absent for an entry/external collateral. */
    ownerNeuronName?: string;
}

export interface ComputeFrontierInput {
    hops: FrontierHop[];
    stimulations: FrontierStimulation[];
    dendrites: FrontierDendrite[];
    collaterals: FrontierCollateral[];
    /** Current time (ms). Injected so the function stays deterministic/testable. */
    now: number;
    /** Ignore stimulations older than this (ms). Default 10 minutes. */
    windowMs?: number;
}

/** Map a frontier element's age (ms) to a severity bucket: 1 fresh → 3 stuck. */
export function frontierSeverity(ageMs: number): 1 | 2 | 3 {
    return ageMs < 1000 ? 1 : ageMs < 4000 ? 2 : 3;
}

/**
 * For each *running* stimulation, find the neurons its hops' output collaterals
 * point at (via dendrite subscriptions) that haven't produced a hop yet — i.e.
 * what's about to run. Each element's timestamp is the earliest pointing hop, so
 * a lingering (stalled) element ages into "stuck".
 */
export function computeFrontier(input: ComputeFrontierInput): FrontierData {
    const {
        hops,
        stimulations,
        dendrites,
        collaterals,
        now,
        windowMs = 10 * 60 * 1000,
    } = input;

    const neurons: Record<string, number> = {};
    const edges: Record<string, number> = {};

    // collateral nodeKey -> subscriber neuron nodeKeys
    const subsByCollateral = new Map<string, Set<string>>();
    for (const d of dendrites) {
        const collKey = nodeKey(d.cnsId, d.collateralName);
        const set = subsByCollateral.get(collKey) || new Set<string>();
        set.add(nodeKey(d.cnsId, d.neuronName));
        subsByCollateral.set(collKey, set);
    }
    // collateral nodeKey -> owner (emitting) neuron nodeKey, and -> display name
    const ownerByCollateral = new Map<string, string>();
    const nameByCollateral = new Map<string, string>();
    for (const c of collaterals) {
        const collKey = nodeKey(c.cnsId, c.name);
        if (c.ownerNeuronName)
            ownerByCollateral.set(collKey, nodeKey(c.cnsId, c.ownerNeuronName));
        nameByCollateral.set(collKey, c.name);
    }

    // hops grouped by stimulation
    const hopsByStim = new Map<string, FrontierHop[]>();
    for (const h of hops) {
        if (!h) continue;
        const arr = hopsByStim.get(h.stimulationId) || [];
        arr.push(h);
        hopsByStim.set(h.stimulationId, arr);
    }

    const bump = (
        bag: Record<string, number>,
        key: string,
        since: number
    ) => {
        // keep the earliest pointing hop → largest age → most "stuck"
        bag[key] = key in bag ? Math.min(bag[key], since) : since;
    };

    for (const s of stimulations) {
        if (!s || s.completedAt != null) continue; // running only
        if (s.startedAt != null && now - s.startedAt > windowMs) continue;
        const stimHops = hopsByStim.get(s.stimulationId) || [];
        const ranNeurons = new Set<string>();
        for (const h of stimHops)
            if (h.neuronName) ranNeurons.add(nodeKey(h.scopeName, h.neuronName));
        for (const h of stimHops) {
            if (!h.outputCollateralName) continue;
            const outColl = nodeKey(h.scopeName, h.outputCollateralName);
            const subs = subsByCollateral.get(outColl);
            if (!subs) continue;
            const source =
                ownerByCollateral.get(outColl) ??
                nodeKey(h.scopeName, h.neuronName);
            const label = nameByCollateral.get(outColl) || h.outputCollateralName;
            const since = typeof h.startedAt === 'number' ? h.startedAt : now;
            for (const target of subs) {
                if (target === source || ranNeurons.has(target)) continue;
                bump(neurons, target, since);
                bump(edges, `${source}->${target}::${label}`, since);
            }
        }
    }
    return { neurons, edges };
}
