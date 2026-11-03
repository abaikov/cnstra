// Client-side aggregation for the Neurons / Collaterals / Tasks views + their
// detail scope-cards. Throughput per neuron comes from the server facets
// (`byNeuron` = activation count); error & fire counts and the per-connection
// stats are derived from the bounded run SNAPSHOT's flat task list (there is no
// server aggregate for those, so we compute over the loaded set — honest numbers,
// bounded to what's loaded). Pure + framework-free so it unit-tests without a DOM.

import type {
    TCNSExplorerSnapshot,
    TCNSExplorerTopology,
} from './explorerClient';
import type { TCNSStimulationFacetsDTO } from '@cnstra/devtools-dto';

export type TCNSConnectionStatistic = {
    collateralName: string;
    /** How many tasks flowed across this connection (in the loaded snapshot). */
    count: number;
    /** How many of those errored. */
    error: number;
};

export type TCNSNeuronRow = {
    name: string;
    /** Activation count (server facets.byNeuron; fallback = snapshot task count). */
    throughput: number;
    /** Tasks that errored on this neuron (snapshot). */
    errors: number;
    /** Number of input collaterals (dendrites). */
    dendrites: number;
    /** Number of output collaterals (axon). */
    axons: number;
};

export type TCNSNeuronDetail = {
    name: string;
    throughput: number;
    errors: number;
    /** Inputs — collaterals this neuron reacts to (fan-in). */
    dendrites: TCNSConnectionStatistic[];
    /** Outputs — collaterals this neuron emits (fan-out / axon). */
    axons: TCNSConnectionStatistic[];
};

export type TCNSCollateralRow = {
    name: string;
    owner?: string;
    isEntry: boolean;
    /** Neurons that react to it (via dendrites). */
    subscribers: number;
    /** Names of the neurons it flows INTO (via their dendrites), for a preview. */
    subscriberNames: string[];
    /** How many times it fired (emitted by a task output or as an entry signal). */
    fires: number;
};

export type TCNSCollateralDetail = {
    name: string;
    owner?: string;
    isEntry: boolean;
    fires: number;
    subscribers: TCNSSubscriberStat[];
    /** Recent emissions of this collateral (its link to activation tasks). */
    dispatches: TCNSCollateralDispatch[];
};
/** One emission of a collateral: which run, at which stage, by whom, with what payload. */
export type TCNSCollateralDispatch = {
    stimulationId: string;
    /** Stage within the stimulation: the task index; -1 = ENTRY signal. */
    stage: number;
    /** Emitting neuron ('' for an ENTRY dispatch — no neuron emits the entry). */
    neuronName: string;
    isEntry: boolean;
    payload: unknown;
    error: string | null;
    startedAt: number;
};
export type TCNSSubscriberStat = {
    neuronName: string;
    count: number;
    error: number;
};

export type TCNSTaskRow = {
    key: string;
    stimulationId: string;
    attemptNumber: number;
    neuronName: string;
    input: string;
    output: string | null;
    status: string;
    error: string | null;
    startedAt: number;
    duration: number | null;
};

const attemptIndex = (
    snap: TCNSExplorerSnapshot
): Map<string, { stimulationId: string; attemptNumber: number }> => {
    const m = new Map<string, { stimulationId: string; attemptNumber: number }>();
    for (const a of snap.attempts)
        m.set(a.stimulationAttemptId, {
            stimulationId: a.stimulationId,
            attemptNumber: a.attemptNumber,
        });
    return m;
};

const throughputMap = (facets: TCNSStimulationFacetsDTO): Map<string, number> => {
    const m = new Map<string, number>();
    for (const n of facets.byNeuron ?? []) m.set(n.name, n.count);
    return m;
};

/** Flat list of activation tasks (newest-first), joined to their stimulation. */
export function buildTaskRows(snap: TCNSExplorerSnapshot): TCNSTaskRow[] {
    const idx = attemptIndex(snap);
    const rows: TCNSTaskRow[] = snap.tasks.map(t => {
        const owner = idx.get(t.stimulationAttemptId);
        return {
            key: `${t.stimulationAttemptId}:${t.index}`,
            stimulationId: owner?.stimulationId ?? t.stimulationAttemptId,
            attemptNumber: owner?.attemptNumber ?? 1,
            neuronName: t.neuronName,
            input: t.dendriteCollateralName,
            output: t.output?.collateralName ?? null,
            status: t.status,
            error: t.error ?? null,
            startedAt: t.startedAt,
            duration: t.duration ?? null,
        };
    });
    rows.sort((a, b) => b.startedAt - a.startedAt);
    return rows;
}

/** One neuron row per topology neuron, with throughput + error + connection counts. */
export function buildNeuronRows(
    topo: TCNSExplorerTopology,
    snap: TCNSExplorerSnapshot,
    facets: TCNSStimulationFacetsDTO
): TCNSNeuronRow[] {
    const tp = throughputMap(facets);
    const taskCount = new Map<string, number>();
    const errCount = new Map<string, number>();
    for (const t of snap.tasks) {
        taskCount.set(t.neuronName, (taskCount.get(t.neuronName) ?? 0) + 1);
        if (t.error)
            errCount.set(t.neuronName, (errCount.get(t.neuronName) ?? 0) + 1);
    }
    const dendriteCount = new Map<string, number>();
    for (const d of topo.dendrites)
        dendriteCount.set(
            d.neuronName,
            (dendriteCount.get(d.neuronName) ?? 0) + 1
        );
    const axonCount = new Map<string, number>();
    for (const c of topo.collaterals)
        if (c.ownerNeuronName)
            axonCount.set(
                c.ownerNeuronName,
                (axonCount.get(c.ownerNeuronName) ?? 0) + 1
            );
    return topo.neurons
        .map(n => ({
            name: n.name,
            throughput: tp.get(n.name) ?? taskCount.get(n.name) ?? 0,
            errors: errCount.get(n.name) ?? 0,
            dendrites: dendriteCount.get(n.name) ?? 0,
            axons: axonCount.get(n.name) ?? 0,
        }))
        .sort((a, b) => b.throughput - a.throughput || a.name.localeCompare(b.name));
}

/** Full neuron detail: fan-in (dendrites) + fan-out (axon) with per-edge stats. */
export function neuronDetail(
    name: string,
    topo: TCNSExplorerTopology,
    snap: TCNSExplorerSnapshot,
    facets: TCNSStimulationFacetsDTO
): TCNSNeuronDetail {
    const tp = throughputMap(facets);
    let errors = 0;
    let taskCount = 0;
    const inCount = new Map<string, TCNSConnectionStatistic>();
    const outCount = new Map<string, TCNSConnectionStatistic>();
    for (const t of snap.tasks) {
        if (t.neuronName !== name) continue;
        taskCount++;
        if (t.error) errors++;
        const inName = t.dendriteCollateralName;
        const inc = inCount.get(inName) ?? { collateralName: inName, count: 0, error: 0 };
        inc.count++;
        if (t.error) inc.error++;
        inCount.set(inName, inc);
        const outName = t.output?.collateralName;
        if (outName) {
            const outc = outCount.get(outName) ?? { collateralName: outName, count: 0, error: 0 };
            outc.count++;
            if (t.error) outc.error++;
            outCount.set(outName, outc);
        }
    }
    // Union the topology-declared connections with the observed ones (declared but
    // never-fired edges render as thin/dashed "no traffic" routes).
    for (const d of topo.dendrites)
        if (d.neuronName === name && !inCount.has(d.collateralName))
            inCount.set(d.collateralName, { collateralName: d.collateralName, count: 0, error: 0 });
    for (const c of topo.collaterals)
        if (c.ownerNeuronName === name && !outCount.has(c.name))
            outCount.set(c.name, { collateralName: c.name, count: 0, error: 0 });

    const byWeight = (a: TCNSConnectionStatistic, b: TCNSConnectionStatistic): number =>
        b.count - a.count || a.collateralName.localeCompare(b.collateralName);
    return {
        name,
        throughput: tp.get(name) ?? taskCount,
        errors,
        dendrites: [...inCount.values()].sort(byWeight),
        axons: [...outCount.values()].sort(byWeight),
    };
}

/** One collateral row per topology collateral, with owner/entry + fire/subscriber counts. */
export function buildCollateralRows(
    topo: TCNSExplorerTopology,
    snap: TCNSExplorerSnapshot
): TCNSCollateralRow[] {
    const fires = new Map<string, number>();
    for (const t of snap.tasks) {
        const out = t.output?.collateralName;
        if (out) fires.set(out, (fires.get(out) ?? 0) + 1);
    }
    for (const s of snap.stimulations) {
        const e = s.entry?.collateralName;
        if (e) fires.set(e, (fires.get(e) ?? 0) + 1);
    }
    const subNames = new Map<string, string[]>();
    for (const d of topo.dendrites) {
        const arr = subNames.get(d.collateralName) ?? [];
        if (!arr.includes(d.neuronName)) arr.push(d.neuronName);
        subNames.set(d.collateralName, arr);
    }
    return topo.collaterals
        .map(c => {
            const names = subNames.get(c.name) ?? [];
            return {
                name: c.name,
                owner: c.ownerNeuronName,
                isEntry: !c.ownerNeuronName,
                subscribers: names.length,
                subscriberNames: names,
                fires: fires.get(c.name) ?? 0,
            };
        })
        .sort((a, b) => b.fires - a.fires || a.name.localeCompare(b.name));
}

/** Full collateral detail: owner neuron + subscriber neurons with fire counts. */
export function collateralDetail(
    name: string,
    topo: TCNSExplorerTopology,
    snap: TCNSExplorerSnapshot
): TCNSCollateralDetail {
    const owner = topo.collaterals.find(c => c.name === name)?.ownerNeuronName;
    let fires = 0;
    for (const t of snap.tasks) if (t.output?.collateralName === name) fires++;
    for (const s of snap.stimulations)
        if (s.entry?.collateralName === name) fires++;
    const subMap = new Map<string, TCNSSubscriberStat>();
    for (const d of topo.dendrites)
        if (d.collateralName === name)
            subMap.set(d.neuronName, {
                neuronName: d.neuronName,
                count: 0,
                error: 0,
            });
    for (const t of snap.tasks) {
        if (t.dendriteCollateralName !== name) continue;
        const s = subMap.get(t.neuronName) ?? {
            neuronName: t.neuronName,
            count: 0,
            error: 0,
        };
        s.count++;
        if (t.error) s.error++;
        subMap.set(t.neuronName, s);
    }
    // Dispatches: every emission of this collateral, joined to its run + stage. A
    // task whose OUTPUT is this collateral is a mid-flow dispatch; a stimulation
    // whose ENTRY is this collateral is the entry dispatch.
    const idx = attemptIndex(snap);
    const dispatches: TCNSCollateralDispatch[] = [];
    for (const t of snap.tasks) {
        if (t.output?.collateralName !== name) continue;
        dispatches.push({
            stimulationId: idx.get(t.stimulationAttemptId)?.stimulationId ?? t.stimulationAttemptId,
            stage: t.index,
            neuronName: t.neuronName,
            isEntry: false,
            payload: t.output?.payload,
            error: t.error ?? null,
            startedAt: t.startedAt,
        });
    }
    for (const s of snap.stimulations) {
        if (s.entry?.collateralName !== name) continue;
        dispatches.push({
            stimulationId: s.stimulationId,
            stage: -1,
            neuronName: '',
            isEntry: true,
            payload: s.entry?.payload,
            error: null,
            startedAt: s.startedAt,
        });
    }
    dispatches.sort((a, b) => b.startedAt - a.startedAt);
    return {
        name,
        owner,
        isEntry: !owner,
        fires,
        subscribers: [...subMap.values()].sort(
            (a, b) => b.count - a.count || a.neuronName.localeCompare(b.neuronName)
        ),
        dispatches: dispatches.slice(0, 50),
    };
}
