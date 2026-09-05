// Big synthetic dataset (env-gated via SEED_BIG=1) — proves the DevTools panel
// scales and that its filters are CORRECT over months of data. It populates:
//   • a realistic TOPOLOGY (~300 neurons, ~400 collaterals with dendrites/axons),
//     injected into the devtools-server repository so `topology.query` returns it;
//   • ~18k STIMULATIONS spread across the last ~90 days (varied entry collaterals,
//     ~80% completed / ~15% failed / ~5% running), each with an attempt + tasks.
//
// Roster/facets are served from a FAST repository that pre-derives the roster
// entries ONCE (the reference in-memory store re-scans every task on every query —
// O(N²) at this scale). Filter/facet semantics are the shared reference helpers
// (`matchesRosterFilter` / `computeRosterFacets` / `keysetPage`), so what the panel
// shows is exactly what those contracts define — the point of the correctness demo.

import {
    keysetPage,
    computeRosterFacets,
    matchesRosterFilter,
    type ICNSStimulationRepository,
    type TCNSRosterEntry,
    type TCNSStimulationState,
    type TCNSStimulationAttempt,
    type TCNSStimulationTask,
    type TCNSStimulationRosterFilter,
    type TCNSStimulationRosterPage,
    type TCNSStimulationRosterFacets,
} from '@cnstra/persist';

// ── deterministic RNG (reproducible screenshots) ──
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export interface TSeedTopologyNode {
    name: string;
    cnsId: string;
    appId: string;
}
export interface TSeedCollateral extends TSeedTopologyNode {
    ownerNeuronName?: string;
}
export interface TSeedDendrite {
    neuronName: string;
    collateralName: string;
    cnsId: string;
    appId: string;
}
export interface TSeedTopology {
    appId: string;
    cnsId: string;
    appName: string;
    version: string;
    timestamp: number;
    neurons: TSeedTopologyNode[];
    collaterals: TSeedCollateral[];
    dendrites: TSeedDendrite[];
}

const DOMAINS = [
    'auth', 'search', 'cart', 'order', 'payment', 'notify', 'inventory',
    'analytics', 'audit', 'user', 'catalog', 'pricing', 'shipping', 'tax',
    'fraud', 'review', 'wishlist', 'reco', 'session', 'email', 'sms', 'push',
    'ledger', 'refund', 'promo', 'loyalty', 'warehouse', 'supplier', 'invoice',
    'report',
]; // 30
const OPS = [
    'Ingest', 'Process', 'Validate', 'Enrich', 'Dispatch', 'Persist', 'Index',
    'Notify', 'Audit', 'Reconcile',
]; // 10 → 300 neurons
const EVENTS = [
    'Requested', 'Started', 'Completed', 'Failed', 'Updated', 'Created',
    'Cancelled', 'Retried', 'Queued', 'Settled', 'Flagged', 'Approved',
    'Rejected', 'Shipped',
];
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

/** Build a realistic topology: 300 neurons, ~400 collaterals, dendrites + axons. */
export function generateBigTopology(
    appId: string,
    cnsId: string,
    appName: string
): TSeedTopology {
    const rnd = mulberry32(1337);
    const neurons: TSeedTopologyNode[] = [];
    for (const d of DOMAINS)
        for (const op of OPS)
            neurons.push({ name: `${d}${op}Neuron`, cnsId, appId });

    const collaterals: TSeedCollateral[] = [];
    // Entry collaterals (job types) — owner-less; stimulations enter here.
    const entries: string[] = [];
    for (let i = 0; i < 24; i++) {
        const name = `${DOMAINS[i % DOMAINS.length]}JobRequested`;
        if (!entries.includes(name)) {
            entries.push(name);
            collaterals.push({ name, cnsId, appId });
        }
    }
    // Owned (axon) collaterals — round-robin owner so every neuron emits ≥1.
    const ownedByNeuron = new Map<string, string[]>();
    const targetOwned = 400 - collaterals.length;
    for (let i = 0; i < targetOwned; i++) {
        const owner = neurons[i % neurons.length].name;
        const dom = DOMAINS[i % DOMAINS.length];
        const ev = EVENTS[Math.floor(i / DOMAINS.length) % EVENTS.length];
        const name = `${dom}${ev}${Math.floor(i / (DOMAINS.length * EVENTS.length))}`;
        collaterals.push({ name, cnsId, appId, ownerNeuronName: owner });
        const list = ownedByNeuron.get(owner) ?? [];
        list.push(name);
        ownedByNeuron.set(owner, list);
    }

    // Dendrites — each neuron subscribes to 2–5 input collaterals.
    const allCollNames = collaterals.map(c => c.name);
    const dendrites: TSeedDendrite[] = [];
    const dendritesByNeuron = new Map<string, string[]>();
    for (const n of neurons) {
        const k = 2 + Math.floor(rnd() * 4);
        const subs = new Set<string>();
        while (subs.size < k)
            subs.add(allCollNames[Math.floor(rnd() * allCollNames.length)]);
        for (const c of subs) dendrites.push({ neuronName: n.name, collateralName: c, cnsId, appId });
        dendritesByNeuron.set(n.name, [...subs]);
    }

    return {
        appId,
        cnsId,
        appName,
        version: '1.0.0-seed',
        timestamp: Date.now(),
        neurons,
        collaterals,
        dendrites,
    };
}

export interface TSeedBuckets {
    stimulations: TCNSStimulationState[];
    attempts: TCNSStimulationAttempt[];
    tasks: TCNSStimulationTask[];
}

const DAY = 24 * 60 * 60 * 1000;

/** Generate ~`count` stimulations spread over the last `days` days, with tasks. */
export function generateBigStimulations(
    topo: TSeedTopology,
    scopeName: string,
    count = 18000,
    days = 90
): TSeedBuckets {
    const rnd = mulberry32(4242);
    const now = Date.now();
    const entries = topo.collaterals.filter(c => !c.ownerNeuronName).map(c => c.name);
    const ownedByNeuron = new Map<string, string[]>();
    for (const c of topo.collaterals)
        if (c.ownerNeuronName) {
            const l = ownedByNeuron.get(c.ownerNeuronName) ?? [];
            l.push(c.name);
            ownedByNeuron.set(c.ownerNeuronName, l);
        }
    const dendritesByNeuron = new Map<string, string[]>();
    for (const d of topo.dendrites) {
        const l = dendritesByNeuron.get(d.neuronName) ?? [];
        l.push(d.collateralName);
        dendritesByNeuron.set(d.neuronName, l);
    }
    const neuronNames = topo.neurons.map(n => n.name);
    const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

    const stimulations: TCNSStimulationState[] = [];
    const attempts: TCNSStimulationAttempt[] = [];
    const tasks: TCNSStimulationTask[] = [];

    for (let i = 0; i < count; i++) {
        const startedAt = now - Math.floor(rnd() * days * DAY);
        const r = rnd();
        const status: 'completed' | 'failed' | 'running' =
            r < 0.8 ? 'completed' : r < 0.95 ? 'failed' : 'running';
        const entry = pick(entries);
        const stimulationId = `stim-${i.toString().padStart(6, '0')}-${startedAt}`;
        const attemptId = `${stimulationId}#1`;

        stimulations.push({
            stimulationId,
            scopeName,
            entry: { collateralName: entry, payload: { i } },
            status,
            progress: { tasks: [] },
        });

        const L = 3 + Math.floor(rnd() * 6); // 3..8 tasks
        let hop = 0;
        let hasError = false;
        for (let j = 0; j < L; j++) {
            const neuron = pick(neuronNames);
            const inputs = dendritesByNeuron.get(neuron);
            const input = inputs && inputs.length ? pick(inputs) : entry;
            const outs = ownedByNeuron.get(neuron);
            const outName = outs && outs.length ? pick(outs) : undefined;
            const isLast = j === L - 1;
            const errored = status === 'failed' && isLast;
            if (errored) hasError = true;
            const tStart = startedAt + j * (200 + Math.floor(rnd() * 400));
            tasks.push({
                stimulationAttemptId: attemptId,
                index: j,
                neuronName: neuron,
                dendriteCollateralName: input,
                inputIndex: 0,
                output: errored || !outName ? null : { collateralName: outName, payload: {} },
                status: errored ? 'failed' : 'done',
                error: errored ? 'synthetic failure: downstream timeout' : null,
                startedAt: tStart,
                duration: errored ? null : 5 + Math.floor(rnd() * 495),
            });
            hop++;
            // A running run stops early (its frontier is still outstanding).
            if (status === 'running' && j >= L - 2) break;
        }

        const completedAt =
            status === 'running' ? null : startedAt + hop * 500 + Math.floor(rnd() * 1000);
        attempts.push({
            stimulationAttemptId: attemptId,
            stimulationId,
            attemptNumber: 1,
            status,
            startedAt,
            completedAt,
            hopCount: hop,
            hasError,
            replayOf: null,
            entry: [{ collateralName: entry, payload: { i } }],
        });
    }
    return { stimulations, attempts, tasks };
}

/**
 * A read-optimized repository for the big seed: it PRE-DERIVES the roster entries
 * once (row + activated neurons) and answers queryRoster/queryFacets in O(N) over
 * that cache, and getAttempts/getTasks in O(1) via indexes — so months of data
 * stay instant. Filter + facet semantics reuse the shared reference helpers.
 */
export class SeedBigStimulationRepository implements ICNSStimulationRepository {
    private readonly stimById = new Map<string, TCNSStimulationState>();
    private readonly attemptsByStim = new Map<string, TCNSStimulationAttempt[]>();
    private readonly tasksByAttempt = new Map<string, TCNSStimulationTask[]>();
    private rosterEntries: TCNSRosterEntry[] = [];

    constructor(buckets: TSeedBuckets) {
        for (const s of buckets.stimulations) this.stimById.set(s.stimulationId, s);
        for (const a of buckets.attempts) {
            const l = this.attemptsByStim.get(a.stimulationId) ?? [];
            l.push(a);
            this.attemptsByStim.set(a.stimulationId, l);
        }
        for (const t of buckets.tasks) {
            const l = this.tasksByAttempt.get(t.stimulationAttemptId) ?? [];
            l.push(t);
            this.tasksByAttempt.set(t.stimulationAttemptId, l);
        }
        this.rebuildRoster();
    }

    private rebuildRoster(): void {
        const entries: TCNSRosterEntry[] = [];
        for (const s of this.stimById.values()) {
            const attempts = this.attemptsByStim.get(s.stimulationId) ?? [];
            const startedAt = attempts.length
                ? Math.min(...attempts.map(a => a.startedAt))
                : 0;
            const last = attempts[attempts.length - 1];
            const completedAt =
                s.status === 'running' ? null : last?.completedAt ?? null;
            const hopCount = attempts.reduce((n, a) => n + a.hopCount, 0);
            const neurons = new Set<string>();
            for (const a of attempts)
                for (const t of this.tasksByAttempt.get(a.stimulationAttemptId) ?? [])
                    neurons.add(t.neuronName);
            entries.push({
                row: {
                    stimulationId: s.stimulationId,
                    scopeName: s.scopeName,
                    entry: s.entry,
                    status: s.status,
                    startedAt,
                    completedAt,
                    hopCount,
                    hasError: s.status === 'failed',
                },
                neurons: [...neurons],
            });
        }
        entries.sort(
            (a, b) =>
                b.row.startedAt - a.row.startedAt ||
                (a.row.stimulationId < b.row.stimulationId ? 1 : -1)
        );
        this.rosterEntries = entries;
    }

    // ── writer (kept for parity; the seed is read-only in practice) ──
    async saveStimulation(s: TCNSStimulationState): Promise<void> {
        this.stimById.set(s.stimulationId, s);
    }
    async saveAttempt(a: TCNSStimulationAttempt): Promise<void> {
        const l = this.attemptsByStim.get(a.stimulationId) ?? [];
        l.push(a);
        this.attemptsByStim.set(a.stimulationId, l);
    }
    async appendTask(t: TCNSStimulationTask): Promise<void> {
        const l = this.tasksByAttempt.get(t.stimulationAttemptId) ?? [];
        l.push(t);
        this.tasksByAttempt.set(t.stimulationAttemptId, l);
    }

    // ── reader ──
    async getStimulation(id: string): Promise<TCNSStimulationState | undefined> {
        return this.stimById.get(id);
    }
    async listStimulations(filter?: {
        scopeName?: string;
    }): Promise<TCNSStimulationState[]> {
        const all = [...this.stimById.values()];
        return filter?.scopeName
            ? all.filter(s => s.scopeName === filter.scopeName)
            : all;
    }
    async getAttempts(id: string): Promise<TCNSStimulationAttempt[]> {
        return this.attemptsByStim.get(id) ?? [];
    }
    async getTasks(attemptId: string): Promise<TCNSStimulationTask[]> {
        return this.tasksByAttempt.get(attemptId) ?? [];
    }
    async delete(id: string): Promise<void> {
        this.stimById.delete(id);
    }

    // ── fast roster query capability (ICNSStimulationRosterQuery) ──
    async queryRoster(
        filter: TCNSStimulationRosterFilter,
        opts: { cursor?: string; limit: number }
    ): Promise<TCNSStimulationRosterPage> {
        const matched = this.rosterEntries.filter(e =>
            matchesRosterFilter(e.row, e.neurons, filter)
        );
        return keysetPage(matched.map(e => e.row), opts);
    }
    async queryFacets(
        filter: TCNSStimulationRosterFilter,
        opts?: { metricPath?: string }
    ): Promise<TCNSStimulationRosterFacets> {
        const matched = this.rosterEntries.filter(e =>
            matchesRosterFilter(e.row, e.neurons, filter)
        );
        return computeRosterFacets(matched, opts);
    }
}
