import { describe, it, expect, beforeEach } from '@jest/globals';

// Test data types for complex connection patterns
interface TestNeuron {
    id: string;
    appId: string;
    name: string;
}

interface TestCollateral {
    collateralName: string;
    neuronId: string;
    appId: string;
    type: string;
}

interface TestDendrite {
    dendriteId: string;
    neuronId: string;
    appId: string;
    collateralName: string;
    type: string;
}

interface TestStimulation {
    stimulationId: string;
    neuronId: string;
    appId: string;
    collateralName: string;
    timestamp: number;
}

interface ConnectionData {
    from: string;
    to: string;
    weight: number;
    stimulationCount: number;
    collateralName: string;
}

// Connection building logic based on the fixed App.tsx logic
function buildConnections(
    collaterals: TestCollateral[],
    dendrites: TestDendrite[],
    stimulations: TestStimulation[]
): ConnectionData[] {
    console.log('🔗 Building connections...');
    console.log('  Collaterals:', collaterals.length);
    console.log('  Dendrites:', dendrites.length);
    console.log('  Stimulations:', stimulations.length);

    const connections: ConnectionData[] = [];
    const ownerByCollateral = new Map<string, string>();

    // Map collateral ownership (axon neurons)
    collaterals.forEach(collateral => {
        const key = String(collateral.collateralName).replace(/^.*:collateral:/, '');
        ownerByCollateral.set(key, collateral.neuronId);
        console.log(`  📡 Collateral "${key}" owned by neuron ${collateral.neuronId}`);
    });

    // Build connections by matching collateral owners with dendrite listeners
    dendrites.forEach(dendrite => {
        const key = String(dendrite.collateralName).replace(/^.*:collateral:/, '');
        const sourceNeuronId = ownerByCollateral.get(key);

        if (sourceNeuronId && sourceNeuronId !== dendrite.neuronId) {
            // Count stimulations on this connection
            const stimulationCount = stimulations.filter(stim =>
                stim.collateralName === dendrite.collateralName
            ).length;

            const connection: ConnectionData = {
                from: sourceNeuronId,
                to: dendrite.neuronId,
                weight: 0.5,
                stimulationCount: stimulationCount,
                collateralName: dendrite.collateralName
            };

            connections.push(connection);
            console.log(`  ➡️ Connection: ${sourceNeuronId} → ${dendrite.neuronId} via ${key} (${stimulationCount} stimulations)`);
        }
    });

    console.log(`✅ Built ${connections.length} connections`);
    return connections;
}

describe('Complex Multi-Directional Neural Network Relationships', () => {
    describe('One-to-Many Relationships', () => {
        let neurons: TestNeuron[];
        let collaterals: TestCollateral[];
        let dendrites: TestDendrite[];
        let stimulations: TestStimulation[];

        beforeEach(() => {
            // Scenario: One neuron broadcasts to three others simultaneously
            neurons = [
                { id: 'hub', appId: 'test-app', name: 'Hub Neuron' },
                { id: 'target1', appId: 'test-app', name: 'Target 1' },
                { id: 'target2', appId: 'test-app', name: 'Target 2' },
                { id: 'target3', appId: 'test-app', name: 'Target 3' },
            ];

            collaterals = [
                { collateralName: 'broadcast', neuronId: 'hub', appId: 'test-app', type: 'output' },
            ];

            dendrites = [
                { dendriteId: 'd1', neuronId: 'target1', appId: 'test-app', collateralName: 'broadcast', type: 'input' },
                { dendriteId: 'd2', neuronId: 'target2', appId: 'test-app', collateralName: 'broadcast', type: 'input' },
                { dendriteId: 'd3', neuronId: 'target3', appId: 'test-app', collateralName: 'broadcast', type: 'input' },
            ];

            stimulations = [
                { stimulationId: 's1', neuronId: 'hub', appId: 'test-app', collateralName: 'broadcast', timestamp: Date.now() - 3000 },
                { stimulationId: 's2', neuronId: 'hub', appId: 'test-app', collateralName: 'broadcast', timestamp: Date.now() - 2000 },
                { stimulationId: 's3', neuronId: 'hub', appId: 'test-app', collateralName: 'broadcast', timestamp: Date.now() - 1000 },
            ];
        });

        it('should create one-to-many connections correctly', () => {
            const connections = buildConnections(collaterals, dendrites, stimulations);

            // Should have 3 connections (hub → target1, hub → target2, hub → target3)
            expect(connections).toHaveLength(3);

            // All connections should originate from hub
            connections.forEach(connection => {
                expect(connection.from).toBe('hub');
                expect(['target1', 'target2', 'target3']).toContain(connection.to);
                expect(connection.collateralName).toBe('broadcast');
            });

            // Each connection should have the same stimulation count (3)
            connections.forEach(connection => {
                expect(connection.stimulationCount).toBe(3);
            });

            console.log('✅ One-to-many relationship verified');
        });

        it('should handle high-frequency broadcasting', () => {
            // Add many more stimulations
            const manyStimulations = [];
            for (let i = 0; i < 100; i++) {
                manyStimulations.push({
                    stimulationId: `burst-${i}`,
                    neuronId: 'hub',
                    appId: 'test-app',
                    collateralName: 'broadcast',
                    timestamp: Date.now() - i * 10
                });
            }

            const connections = buildConnections(collaterals, dendrites, [...stimulations, ...manyStimulations]);

            expect(connections).toHaveLength(3);
            connections.forEach(connection => {
                expect(connection.stimulationCount).toBe(103); // 3 original + 100 burst
            });

            console.log('🔥 High-frequency broadcasting verified:', connections[0].stimulationCount, 'stimulations per connection');
        });
    });

    describe('Many-to-One Relationships', () => {
        let neurons: TestNeuron[];
        let collaterals: TestCollateral[];
        let dendrites: TestDendrite[];
        let stimulations: TestStimulation[];

        beforeEach(() => {
            // Scenario: Two neurons feed back to the first one
            neurons = [
                { id: 'collector', appId: 'test-app', name: 'Collector Neuron' },
                { id: 'source1', appId: 'test-app', name: 'Source 1' },
                { id: 'source2', appId: 'test-app', name: 'Source 2' },
            ];

            collaterals = [
                { collateralName: 'feedback1', neuronId: 'source1', appId: 'test-app', type: 'output' },
                { collateralName: 'feedback2', neuronId: 'source2', appId: 'test-app', type: 'output' },
            ];

            dendrites = [
                { dendriteId: 'd1', neuronId: 'collector', appId: 'test-app', collateralName: 'feedback1', type: 'input' },
                { dendriteId: 'd2', neuronId: 'collector', appId: 'test-app', collateralName: 'feedback2', type: 'input' },
            ];

            stimulations = [
                { stimulationId: 's1', neuronId: 'source1', appId: 'test-app', collateralName: 'feedback1', timestamp: Date.now() - 2000 },
                { stimulationId: 's2', neuronId: 'source1', appId: 'test-app', collateralName: 'feedback1', timestamp: Date.now() - 1500 },
                { stimulationId: 's3', neuronId: 'source2', appId: 'test-app', collateralName: 'feedback2', timestamp: Date.now() - 1000 },
            ];
        });

        it('should create many-to-one connections correctly', () => {
            const connections = buildConnections(collaterals, dendrites, stimulations);

            // Should have 2 connections (source1 → collector, source2 → collector)
            expect(connections).toHaveLength(2);

            // All connections should target collector
            connections.forEach(connection => {
                expect(connection.to).toBe('collector');
                expect(['source1', 'source2']).toContain(connection.from);
            });

            // Check individual stimulation counts
            const feedback1Connection = connections.find(c => c.collateralName === 'feedback1');
            const feedback2Connection = connections.find(c => c.collateralName === 'feedback2');

            expect(feedback1Connection?.stimulationCount).toBe(2);
            expect(feedback2Connection?.stimulationCount).toBe(1);

            console.log('✅ Many-to-one relationship verified');
        });
    });

    describe('Circular Relationships', () => {
        let neurons: TestNeuron[];
        let collaterals: TestCollateral[];
        let dendrites: TestDendrite[];
        let stimulations: TestStimulation[];

        beforeEach(() => {
            // Scenario: Three neurons in a circular relationship (A → B → C → A)
            neurons = [
                { id: 'neuronA', appId: 'test-app', name: 'Neuron A' },
                { id: 'neuronB', appId: 'test-app', name: 'Neuron B' },
                { id: 'neuronC', appId: 'test-app', name: 'Neuron C' },
            ];

            collaterals = [
                { collateralName: 'toB', neuronId: 'neuronA', appId: 'test-app', type: 'output' },
                { collateralName: 'toC', neuronId: 'neuronB', appId: 'test-app', type: 'output' },
                { collateralName: 'toA', neuronId: 'neuronC', appId: 'test-app', type: 'output' },
            ];

            dendrites = [
                { dendriteId: 'd1', neuronId: 'neuronB', appId: 'test-app', collateralName: 'toB', type: 'input' },
                { dendriteId: 'd2', neuronId: 'neuronC', appId: 'test-app', collateralName: 'toC', type: 'input' },
                { dendriteId: 'd3', neuronId: 'neuronA', appId: 'test-app', collateralName: 'toA', type: 'input' },
            ];

            stimulations = [
                { stimulationId: 's1', neuronId: 'neuronA', appId: 'test-app', collateralName: 'toB', timestamp: Date.now() - 3000 },
                { stimulationId: 's2', neuronId: 'neuronB', appId: 'test-app', collateralName: 'toC', timestamp: Date.now() - 2000 },
                { stimulationId: 's3', neuronId: 'neuronC', appId: 'test-app', collateralName: 'toA', timestamp: Date.now() - 1000 },
                { stimulationId: 's4', neuronId: 'neuronA', appId: 'test-app', collateralName: 'toB', timestamp: Date.now() - 500 },
            ];
        });

        it('should create circular connections correctly', () => {
            const connections = buildConnections(collaterals, dendrites, stimulations);

            // Should have 3 connections forming a circle
            expect(connections).toHaveLength(3);

            // Verify each connection in the circle
            const connectionMap = new Map<string, string>();
            connections.forEach(connection => {
                connectionMap.set(connection.from, connection.to);
            });

            expect(connectionMap.get('neuronA')).toBe('neuronB');
            expect(connectionMap.get('neuronB')).toBe('neuronC');
            expect(connectionMap.get('neuronC')).toBe('neuronA');

            // Check stimulation counts
            const toBConnection = connections.find(c => c.collateralName === 'toB');
            const toCConnection = connections.find(c => c.collateralName === 'toC');
            const toAConnection = connections.find(c => c.collateralName === 'toA');

            expect(toBConnection?.stimulationCount).toBe(2); // 2 stimulations on toB
            expect(toCConnection?.stimulationCount).toBe(1); // 1 stimulation on toC
            expect(toAConnection?.stimulationCount).toBe(1); // 1 stimulation on toA

            console.log('🔄 Circular relationship verified');
        });
    });

    describe('Complex Multi-Path Relationships', () => {
        let neurons: TestNeuron[];
        let collaterals: TestCollateral[];
        let dendrites: TestDendrite[];
        let stimulations: TestStimulation[];

        beforeEach(() => {
            // Scenario: Complex network with multiple paths and feedback loops
            // neuron1 → neuron2, neuron3
            // neuron2 → neuron3, neuron1 (feedback)
            // neuron3 → neuron2 (feedback)
            neurons = [
                { id: 'neuron1', appId: 'test-app', name: 'Input Processor' },
                { id: 'neuron2', appId: 'test-app', name: 'Middle Processor' },
                { id: 'neuron3', appId: 'test-app', name: 'Output Processor' },
            ];

            collaterals = [
                { collateralName: 'primary', neuronId: 'neuron1', appId: 'test-app', type: 'output' },
                { collateralName: 'secondary', neuronId: 'neuron1', appId: 'test-app', type: 'output' },
                { collateralName: 'feedback', neuronId: 'neuron2', appId: 'test-app', type: 'output' },
                { collateralName: 'processed', neuronId: 'neuron2', appId: 'test-app', type: 'output' },
                { collateralName: 'refined', neuronId: 'neuron3', appId: 'test-app', type: 'output' },
            ];

            dendrites = [
                // neuron1 → neuron2 (primary), neuron3 (secondary)
                { dendriteId: 'd1', neuronId: 'neuron2', appId: 'test-app', collateralName: 'primary', type: 'input' },
                { dendriteId: 'd2', neuronId: 'neuron3', appId: 'test-app', collateralName: 'secondary', type: 'input' },
                // neuron2 → neuron3 (processed), neuron1 (feedback)
                { dendriteId: 'd3', neuronId: 'neuron3', appId: 'test-app', collateralName: 'processed', type: 'input' },
                { dendriteId: 'd4', neuronId: 'neuron1', appId: 'test-app', collateralName: 'feedback', type: 'input' },
                // neuron3 → neuron2 (refined)
                { dendriteId: 'd5', neuronId: 'neuron2', appId: 'test-app', collateralName: 'refined', type: 'input' },
            ];

            stimulations = [
                // Initial stimulations
                { stimulationId: 's1', neuronId: 'neuron1', appId: 'test-app', collateralName: 'primary', timestamp: Date.now() - 5000 },
                { stimulationId: 's2', neuronId: 'neuron1', appId: 'test-app', collateralName: 'secondary', timestamp: Date.now() - 4800 },
                // Processing stimulations
                { stimulationId: 's3', neuronId: 'neuron2', appId: 'test-app', collateralName: 'processed', timestamp: Date.now() - 4000 },
                { stimulationId: 's4', neuronId: 'neuron2', appId: 'test-app', collateralName: 'feedback', timestamp: Date.now() - 3500 },
                // Refinement stimulations
                { stimulationId: 's5', neuronId: 'neuron3', appId: 'test-app', collateralName: 'refined', timestamp: Date.now() - 3000 },
                // Additional cycles
                { stimulationId: 's6', neuronId: 'neuron1', appId: 'test-app', collateralName: 'primary', timestamp: Date.now() - 2000 },
                { stimulationId: 's7', neuronId: 'neuron2', appId: 'test-app', collateralName: 'processed', timestamp: Date.now() - 1500 },
                { stimulationId: 's8', neuronId: 'neuron3', appId: 'test-app', collateralName: 'refined', timestamp: Date.now() - 1000 },
            ];
        });

        it('should handle complex multi-path relationships', () => {
            const connections = buildConnections(collaterals, dendrites, stimulations);

            // Should have 5 connections total
            expect(connections).toHaveLength(5);

            // Verify specific connections exist
            const connectionPairs = connections.map(c => `${c.from}→${c.to}`);
            expect(connectionPairs).toContain('neuron1→neuron2'); // primary
            expect(connectionPairs).toContain('neuron1→neuron3'); // secondary
            expect(connectionPairs).toContain('neuron2→neuron3'); // processed
            expect(connectionPairs).toContain('neuron2→neuron1'); // feedback
            expect(connectionPairs).toContain('neuron3→neuron2'); // refined

            // Verify stimulation counts on different paths
            const primaryConnection = connections.find(c => c.from === 'neuron1' && c.to === 'neuron2');
            const processedConnection = connections.find(c => c.from === 'neuron2' && c.to === 'neuron3');
            const refinedConnection = connections.find(c => c.from === 'neuron3' && c.to === 'neuron2');

            expect(primaryConnection?.stimulationCount).toBe(2); // 2 primary stimulations
            expect(processedConnection?.stimulationCount).toBe(2); // 2 processed stimulations
            expect(refinedConnection?.stimulationCount).toBe(2); // 2 refined stimulations

            console.log('🕸️ Complex multi-path relationship verified');
        });

        it('should handle neurons with multiple input and output paths', () => {
            const connections = buildConnections(collaterals, dendrites, stimulations);

            // Check that neuron2 has both inputs and outputs
            const neuron2Inputs = connections.filter(c => c.to === 'neuron2');
            const neuron2Outputs = connections.filter(c => c.from === 'neuron2');

            expect(neuron2Inputs).toHaveLength(2); // primary from neuron1, refined from neuron3
            expect(neuron2Outputs).toHaveLength(2); // processed to neuron3, feedback to neuron1

            // Check that neuron3 has multiple inputs
            const neuron3Inputs = connections.filter(c => c.to === 'neuron3');
            expect(neuron3Inputs).toHaveLength(2); // secondary from neuron1, processed from neuron2

            console.log('🔀 Multiple input/output paths verified');
        });

        it('should calculate stimulation counts correctly for overlapping paths', () => {
            const connections = buildConnections(collaterals, dendrites, stimulations);

            // Group stimulations by collateral to verify counts
            const stimulationCounts = new Map<string, number>();
            stimulations.forEach(stim => {
                const current = stimulationCounts.get(stim.collateralName) || 0;
                stimulationCounts.set(stim.collateralName, current + 1);
            });

            // Verify each connection has correct stimulation count
            connections.forEach(connection => {
                const expectedCount = stimulationCounts.get(connection.collateralName) || 0;
                expect(connection.stimulationCount).toBe(expectedCount);
            });

            console.log('📊 Stimulation counts verified for overlapping paths');
        });
    });

    describe('Edge Cases and Error Conditions', () => {
        it('should handle orphaned collaterals (no listening dendrites)', () => {
            const collaterals = [
                { collateralName: 'orphaned', neuronId: 'neuron1', appId: 'test-app', type: 'output' },
            ];
            const dendrites: TestDendrite[] = []; // No dendrites listening
            const stimulations: TestStimulation[] = [];

            const connections = buildConnections(collaterals, dendrites, stimulations);
            expect(connections).toHaveLength(0);

            console.log('🚫 Orphaned collaterals handled correctly');
        });

        it('should handle orphaned dendrites (no owning collaterals)', () => {
            const collaterals: TestCollateral[] = []; // No collaterals
            const dendrites = [
                { dendriteId: 'd1', neuronId: 'neuron1', appId: 'test-app', collateralName: 'missing', type: 'input' },
            ];
            const stimulations: TestStimulation[] = [];

            const connections = buildConnections(collaterals, dendrites, stimulations);
            expect(connections).toHaveLength(0);

            console.log('🚫 Orphaned dendrites handled correctly');
        });

        it('should prevent self-connections', () => {
            const collaterals = [
                { collateralName: 'self', neuronId: 'neuron1', appId: 'test-app', type: 'output' },
            ];
            const dendrites = [
                { dendriteId: 'd1', neuronId: 'neuron1', appId: 'test-app', collateralName: 'self', type: 'input' },
            ];
            const stimulations = [
                { stimulationId: 's1', neuronId: 'neuron1', appId: 'test-app', collateralName: 'self', timestamp: Date.now() },
            ];

            const connections = buildConnections(collaterals, dendrites, stimulations);
            expect(connections).toHaveLength(0); // Self-connections should be filtered out

            console.log('🔄 Self-connections prevented correctly');
        });

        it('should handle empty datasets gracefully', () => {
            const connections = buildConnections([], [], []);
            expect(connections).toHaveLength(0);

            console.log('🗂️ Empty datasets handled gracefully');
        });
    });
});