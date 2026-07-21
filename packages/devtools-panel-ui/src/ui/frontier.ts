// Pure, framework-free logic for the "live frontier": which neurons/edges are
// about to run (from topology + the last hops), and how a stalled one ages into
// a "stuck" state. Kept side-effect-free so it can be unit-tested without a
// browser or cytoscape.

export interface FrontierData {
    /** neuronId -> entered-frontier timestamp (ms). */
    neurons: Record<string, number>;
    /** edgeId (`${from}->${to}::${label}`) -> entered-frontier timestamp (ms). */
    edges: Record<string, number>;
}

export const EMPTY_FRONTIER: FrontierData = { neurons: {}, edges: {} };

// Minimal structural shapes (subset of the DTO/UI entities we actually read).
export interface FrontierHop {
    stimulationId: string;
    neuronId: string;
    outputCollateralId?: string | null;
    startedAt?: number;
}
export interface FrontierStimulation {
    id: string;
    completedAt?: number | null;
    startedAt?: number;
}
export interface FrontierDendrite {
    neuronId: string;
    collateralId: string;
}
export interface FrontierCollateral {
    id: string;
    neuronId?: string;
    name?: string;
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

    // collateralId -> subscriber neuronIds
    const subsByCollateral = new Map<string, Set<string>>();
    for (const d of dendrites) {
        const set = subsByCollateral.get(d.collateralId) || new Set<string>();
        set.add(d.neuronId);
        subsByCollateral.set(d.collateralId, set);
    }
    // collateralId -> owner (emitting) neuronId, and -> display name
    const ownerByCollateral = new Map<string, string>();
    const nameByCollateral = new Map<string, string>();
    for (const c of collaterals) {
        if (c.neuronId && c.neuronId !== 'unknown')
            ownerByCollateral.set(c.id, c.neuronId);
        if (c.name) nameByCollateral.set(c.id, c.name);
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
        const stimHops = hopsByStim.get(s.id) || [];
        const ranNeurons = new Set<string>();
        for (const h of stimHops) if (h.neuronId) ranNeurons.add(h.neuronId);
        for (const h of stimHops) {
            const outColl = h.outputCollateralId;
            if (!outColl) continue;
            const subs = subsByCollateral.get(outColl);
            if (!subs) continue;
            const source = ownerByCollateral.get(outColl) || h.neuronId;
            const label = nameByCollateral.get(outColl) || outColl;
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
