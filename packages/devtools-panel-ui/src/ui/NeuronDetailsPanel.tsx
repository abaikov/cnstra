import type { TExoSchema } from '@exodra/core';
import { bindable } from '@exodra/reactivity';
import type { TExoBindable } from '@exodra/reactivity';
import {
    combine,
    readEntityByPk,
    subscribeEntityByPk,
    readEntitiesByIndexKey,
    subscribeEntitiesByIndexKey,
} from '../exo/oimdb-bind';
import { notNull, fmtTime, nodeKey } from '../utils/format';
import { DECAY_ICONS } from './theme-utils';
import { jsonView } from './json-view';
import { db } from '../model';
import type { TCNSDendriteDTO, TCNSNeuronDTO, TCNSHopState } from '../model';

// Native Exodra port of the React <NeuronDetailsPanel> island. A fixed side overlay
// shown while a neuron is selected. Data comes from @oimdb/exodra read/subscribe
// (flush-safe); the two little presentational Decay* components are inlined (they're
// class-based). Rendered by TopologyView reactively on the selected neuron.

// ── inlined Decay presentational bits (class-based, from DecayComponents) ──
const decayCard = (title: string, glowing: boolean, body: TExoSchema): TExoSchema => (
    <div static={{ class: `card-decay ${glowing ? 'pulse-infection' : ''}` }}>
        <h3 static={{ class: 'heading-decay md' }}>{DECAY_ICONS.skull} {title}</h3>
        {body}
    </div>
);

const decayStatus = (
    status: 'healthy' | 'infected' | 'critical',
    label: string
): TExoSchema => {
    const cls = {
        healthy: 'status-healthy',
        infected: 'status-infected flicker',
        critical: 'status-critical',
    }[status];
    const icon = {
        healthy: DECAY_ICONS.heart,
        infected: DECAY_ICONS.virus,
        critical: DECAY_ICONS.skull,
    }[status];
    return <div static={{ class: cls }}>{icon} {label}</div>;
};

const activityLevel = (
    count: number
): { level: string; status: 'healthy' | 'infected' | 'critical' } => {
    if (count === 0) return { level: 'Inactive', status: 'healthy' };
    if (count < 5) return { level: 'Low', status: 'healthy' };
    if (count < 15) return { level: 'Medium', status: 'infected' };
    if (count < 30) return { level: 'High', status: 'infected' };
    if (count < 50) return { level: 'Very High', status: 'critical' };
    return { level: 'Critical', status: 'critical' };
};


export function neuronDetailsPanel(
    neuronRefB: TExoBindable<{ cnsId: string; name: string } | null>,
    appIdB: TExoBindable<string | undefined>,
    onClose: () => void
): TExoSchema {
    const neuronB = bindable<TCNSNeuronDTO | undefined>(undefined);
    const dendritesB = bindable<TCNSDendriteDTO[]>([]);
    const responsesB = bindable<TCNSHopState[]>([]);

    let unsubs: Array<() => void> = [];
    const read = (): void => {
        const ref = neuronRefB.getValue();
        const appId = appIdB.getValue() || 'unknown';
        neuronB.setValue(
            ref
                ? (readEntityByPk(db.neurons, [ref.cnsId, ref.name]) as
                      | TCNSNeuronDTO
                      | undefined)
                : undefined
        );
        // The neuronName index is primitive (names can repeat across cns), so scope
        // the result to this neuron's cns.
        dendritesB.setValue(
            ref
                ? notNull(
                      readEntitiesByIndexKey(
                          db.dendrites,
                          db.dendrites.indexes.neuronName,
                          ref.name
                      )
                  ).filter(d => d.cnsId === ref.cnsId)
                : []
        );
        responsesB.setValue(
            notNull(
                readEntitiesByIndexKey(
                    db.responses,
                    db.responses.indexes.appId,
                    appId
                )
            )
        );
    };
    const wire = (): void => {
        for (const u of unsubs) u();
        unsubs = [];
        const ref = neuronRefB.getValue();
        const appId = appIdB.getValue() || 'unknown';
        read();
        if (ref) {
            unsubs.push(
                subscribeEntityByPk(db.neurons, [ref.cnsId, ref.name], read),
                subscribeEntitiesByIndexKey(db.dendrites, db.dendrites.indexes.neuronName, ref.name, read)
            );
        }
        unsubs.push(
            subscribeEntitiesByIndexKey(db.responses, db.responses.indexes.appId, appId, read)
        );
    };
    neuronRefB.subscribe(wire);
    appIdB.subscribe(wire);
    wire();

    const responseRow = (resp: TCNSHopState): TExoSchema => (
        <div static={{ style: 'font-size:var(--font-size-xs);padding:var(--spacing-xs) 0;border-bottom:1px dashed var(--border-primary)' }}>
            <div static={{ style: 'display:flex;justify-content:space-between' }}>
                <span static={{ style: 'color:var(--text-accent)' }}>{resp.dendriteCollateralName || '?'}</span>
                <span>→</span>
                <span static={{ style: 'color:var(--decay-orange)' }}>{resp.output?.collateralName || 'no output'}</span>
            </div>
            <div static={{ style: 'color:var(--text-muted);font-size:var(--font-size-2xs)' }}>{fmtTime(resp.startedAt)}</div>
            {resp.output?.payload != null ? (
                <div static={{ style: 'margin-top:4px;font-size:var(--font-size-2xs)' }}>
                    {jsonView(resp.output.payload)}
                </div>
            ) : (
                <div />
            )}
        </div>
    );

    const dendriteBlock = (dendrite: TCNSDendriteDTO, responses: TCNSHopState[]): TExoSchema => {
        const dName = dendrite.collateralName;
        const dendriteResponses = responses.filter(
            r => r.dendriteCollateralName === dName
        );
        const recent = dendriteResponses
            .slice()
            .sort((a, b) => b.startedAt - a.startedAt)
            .slice(0, 15);
        return (
            <div static={{ style: 'padding:var(--spacing-sm);background:var(--bg-card);border:1px solid var(--border-primary);border-radius:var(--radius-sm)' }}>
                <div static={{ style: 'margin-bottom:var(--spacing-xs);color:var(--decay-blue);font-weight:bold' }}>{DECAY_ICONS.dna} {dName}</div>
                <div static={{ style: 'font-size:var(--font-size-xs);color:var(--text-muted)' }}>Responses: {String(dendriteResponses.length)}</div>
                {recent.length > 0 ? (
                    <div static={{ style: 'margin-top:var(--spacing-xs);padding-left:var(--spacing-sm);border-left:2px solid var(--border-primary)' }}>
                        {recent.map(responseRow)}
                    </div>
                ) : (
                    <div />
                )}
            </div>
        );
    };

    const render = (
        neuron: TCNSNeuronDTO | undefined,
        dendrites: TCNSDendriteDTO[],
        responses: TCNSHopState[]
    ): TExoSchema => {
        if (!neuron) return <div />;

        // Scope the app-wide hop stream to THIS neuron's cns (names are unique per
        // cns, not per app — guard against a same-named collateral in another cns).
        const scopedResponses = responses.filter(
            r => r.scopeName === neuron.cnsId
        );
        const dendriteNames = dendrites.map(d => d.collateralName);
        const neuronCollateralNames = db.collaterals
            .getAll()
            .filter(
                c => c.cnsId === neuron.cnsId && c.ownerNeuronName === neuron.name
            )
            .map(c => c.name);
        const inputSignals = scopedResponses.filter(
            r =>
                r.dendriteCollateralName != null &&
                dendriteNames.includes(r.dendriteCollateralName)
        );
        const outputSignals = scopedResponses.filter(
            r =>
                r.output != null &&
                neuronCollateralNames.includes(r.output.collateralName)
        );

        try {
            (window as unknown as Record<string, unknown>).__neuronPanelDebug = {
                neuronId: nodeKey(neuron.cnsId, neuron.name),
                appId: appIdB.getValue() || 'unknown',
                allResponses: responses.length,
                inputSignals: inputSignals.length,
                outputSignals: outputSignals.length,
                dendriteNames,
                neuronCollateralNames,
            };
        } catch {
            /* debug only */
        }

        // Activity is derived from this neuron's own signal traffic (no stored,
        // polling-inflated counter).
        const signalCount = inputSignals.length + outputSignals.length;
        const activity = activityLevel(signalCount);

        return (
            <div static={{ class: 'neuron-details-panel', style: 'position:fixed;top:0;right:0;width:600px;height:100vh;background:var(--bg-panel);border:2px solid var(--border-infected);border-top:none;border-right:none;box-shadow:inset 0 0 20px var(--shadow-blood),-5px 0 15px var(--shadow-dark);z-index:1000;overflow-y:auto;padding:var(--spacing-lg)' }}>
                <div static={{ style: 'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--spacing-lg);gap:var(--spacing-md)' }}>
                    <div static={{ style: 'flex:1' }}>
                        <h2 static={{ class: 'heading-decay md decay-glow', style: 'margin:0;color:var(--infection-red);text-shadow:0 0 5px var(--infection-red);font-size:var(--font-size-lg);line-height:1.2' }}>{DECAY_ICONS.brain} {neuron.name}</h2>
                        <div static={{ style: 'font-size:var(--font-size-xs);color:var(--text-muted);margin-top:var(--spacing-xs)' }}>ID: <code static={{ style: 'color:var(--text-accent)' }}>{nodeKey(neuron.cnsId, neuron.name)}</code></div>
                    </div>
                    <button static={{ class: 'btn-infected', style: 'min-width:40px;padding:var(--spacing-xs);font-size:var(--font-size-sm)' }} handlers={{ onClick: onClose }}>✕</button>
                </div>

                {decayCard(
                    'Neuron Information',
                    false,
                    <div>
                        <strong>Activity Level:</strong>
                        {decayStatus(activity.status, activity.level)}
                    </div>
                )}

                {decayCard(
                    'Activity Metrics',
                    signalCount > 30,
                    <div static={{ style: 'display:grid;grid-template-columns:1fr 1fr;gap:var(--spacing-sm)' }}>
                        <div static={{ style: 'text-align:center' }}>
                            <div static={{ style: 'display:flex;gap:var(--spacing-md);justify-content:center' }}>
                                <div static={{ style: 'text-align:center' }}>
                                    <div static={{ style: 'font-size:var(--font-size-lg);color:var(--decay-blue);font-weight:bold' }}>{String(inputSignals.length)}</div>
                                    <div static={{ style: 'font-size:var(--font-size-xs);color:var(--text-muted)' }}>Input Signals</div>
                                </div>
                                <div static={{ style: 'text-align:center' }}>
                                    <div static={{ style: 'font-size:var(--font-size-lg);color:var(--decay-orange);font-weight:bold' }}>{String(outputSignals.length)}</div>
                                    <div static={{ style: 'font-size:var(--font-size-xs);color:var(--text-muted)' }}>Output Signals</div>
                                </div>
                            </div>
                        </div>
                        <div static={{ style: 'text-align:center' }}>
                            <div static={{ style: 'font-size:var(--font-size-2xl);color:var(--infection-green);font-weight:bold' }}>{String(inputSignals.length + outputSignals.length)}</div>
                            <div static={{ style: 'font-size:var(--font-size-xs);color:var(--text-muted)' }}>Total Signals</div>
                        </div>
                    </div>
                )}

                {decayCard(
                    'Dendrites & Response History',
                    false,
                    dendrites.length > 0 ? (
                        <div static={{ style: 'display:flex;flex-direction:column;gap:var(--spacing-md)' }}>
                            {dendrites.map(d => dendriteBlock(d, scopedResponses))}
                        </div>
                    ) : (
                        <div static={{ style: 'text-align:center;color:var(--text-muted);font-style:italic' }}>{DECAY_ICONS.skull} No dendrites found</div>
                    )
                )}
            </div>
        );
    };

    const content = combine([neuronB, dendritesB, responsesB], () =>
        render(neuronB.getValue(), dendritesB.getValue(), responsesB.getValue())
    );
    return <div bindable={{ children: content }} />;
}
