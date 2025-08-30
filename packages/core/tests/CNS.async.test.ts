import { CNS, collateral, neuron, withCtx } from '../src/index';

describe('CNS - Async Test Suite', () => {
    describe('Sync Scenarios', () => {
        it('should handle immediate sync response', () => {
            const input = collateral<{ value: number }>('input');
            const output = collateral<{ result: number }>('output');

            const syncNeuron = neuron('sync', { output }).dendrite({
                collateral: input,
                response: (payload, axon) => {
                    const value = (payload as { value: number }).value;
                    return axon.output.createSignal({ result: value * 2 });
                }
            });

            const cns = new CNS([syncNeuron]);
            const traces: Array<{ collateralId: string; payload: unknown }> = [];

            const result = cns.stimulate(input, { value: 10 }, {
                onTrace: trace => traces.push({ collateralId: trace.collateralId, payload: trace.payload })
            });

            expect(result).toBeUndefined(); // Sync completion
            expect(traces).toHaveLength(2);
            expect(traces[1]).toMatchObject({ collateralId: 'output', payload: { result: 20 } });
        });

        it('should handle sync chain processing', () => {
            const input = collateral<{ value: number }>('input');
            const middle = collateral<{ value: number }>('middle');
            const output = collateral<{ result: number }>('output');

            const step1 = neuron('step1', { middle }).dendrite({
                collateral: input,
                response: (payload, axon) => {
                    const value = (payload as { value: number }).value;
                    return axon.middle.createSignal({ value: value + 5 });
                }
            });

            const step2 = neuron('step2', { output }).dendrite({
                collateral: middle,
                response: (payload, axon) => {
                    const value = (payload as { value: number }).value;
                    return axon.output.createSignal({ result: value * 3 });
                }
            });

            const cns = new CNS([step1, step2]);
            const traces: Array<{ collateralId: string; payload: unknown }> = [];

            const result = cns.stimulate(input, { value: 7 }, {
                onTrace: trace => traces.push({ collateralId: trace.collateralId, payload: trace.payload })
            });

            expect(result).toBeUndefined();
            expect(traces).toHaveLength(3);
            expect(traces[2]).toMatchObject({ collateralId: 'output', payload: { result: 36 } }); // (7+5)*3
        });

        it('should handle sync fan-out', () => {
            const input = collateral<{ data: string }>('input');
            const branch1 = collateral<{ result: string }>('branch1');
            const branch2 = collateral<{ result: string }>('branch2');

            // Create two separate neurons that both respond to input
            const processor1 = neuron('proc1', { branch1 }).dendrite({
                collateral: input,
                response: (payload, axon) => {
                    const data = (payload as { data: string }).data;
                    return axon.branch1.createSignal({ result: `A-${data}` });
                }
            });

            const processor2 = neuron('proc2', { branch2 }).dendrite({
                collateral: input,
                response: (payload, axon) => {
                    const data = (payload as { data: string }).data;
                    return axon.branch2.createSignal({ result: `B-${data}` });
                }
            });

            const cns = new CNS([processor1, processor2]);
            const traces: Array<{ collateralId: string; payload: unknown }> = [];

            const result = cns.stimulate(input, { data: 'test' }, {
                onTrace: trace => traces.push({ collateralId: trace.collateralId, payload: trace.payload })
            });

            expect(result).toBeUndefined();
            expect(traces).toHaveLength(3); // input + 2 branches
            expect(traces.find(t => t.collateralId === 'branch1')?.payload).toEqual({ result: 'A-test' });
            expect(traces.find(t => t.collateralId === 'branch2')?.payload).toEqual({ result: 'B-test' });
        });
    });

    describe('Basic Async Scenarios', () => {
        it('should handle single async response', async () => {
            const input = collateral<{ delay: number; message: string }>('input');
            const output = collateral<{ result: string }>('output');

            const asyncNeuron = neuron('async', { output }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    const { delay, message } = payload as { delay: number; message: string };
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return axon.output.createSignal({ result: `async-${message}` });
                }
            });

            const cns = new CNS([asyncNeuron]);
            const traces: Array<{ collateralId: string; payload: unknown }> = [];
            const startTime = Date.now();

            const result = cns.stimulate(input, { delay: 30, message: 'test' }, {
                onTrace: trace => traces.push({ collateralId: trace.collateralId, payload: trace.payload })
            });

            expect(result).toBeInstanceOf(Promise);
            await result;

            const elapsed = Date.now() - startTime;
            expect(elapsed).toBeGreaterThanOrEqual(30);
            expect(traces).toHaveLength(2);
            expect(traces[1]).toMatchObject({ collateralId: 'output', payload: { result: 'async-test' } });
        });

        it('should handle async chain', async () => {
            const input = collateral<{ value: number }>('input');
            const step1 = collateral<{ value: number }>('step1');
            const step2 = collateral<{ value: number }>('step2');
            const output = collateral<{ result: number }>('output');

            const asyncStep1 = neuron('async1', { step1 }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    const value = (payload as { value: number }).value;
                    await new Promise(resolve => setTimeout(resolve, 20));
                    return axon.step1.createSignal({ value: value * 2 });
                }
            });

            const asyncStep2 = neuron('async2', { step2 }).dendrite({
                collateral: step1,
                response: async (payload, axon) => {
                    const value = (payload as { value: number }).value;
                    await new Promise(resolve => setTimeout(resolve, 15));
                    return axon.step2.createSignal({ value: value + 10 });
                }
            });

            const syncFinal = neuron('final', { output }).dendrite({
                collateral: step2,
                response: (payload, axon) => {
                    const value = (payload as { value: number }).value;
                    return axon.output.createSignal({ result: value * 3 });
                }
            });

            const cns = new CNS([asyncStep1, asyncStep2, syncFinal]);
            const traces: Array<{ collateralId: string; payload: unknown }> = [];
            const startTime = Date.now();

            const result = cns.stimulate(input, { value: 5 }, {
                onTrace: trace => traces.push({ collateralId: trace.collateralId, payload: trace.payload })
            });

            await result;
            const elapsed = Date.now() - startTime;

            expect(elapsed).toBeGreaterThanOrEqual(35); // 20ms + 15ms
            expect(traces).toHaveLength(4);
            expect(traces[3]).toMatchObject({ collateralId: 'output', payload: { result: 60 } }); // ((5*2)+10)*3
        });

        // TODO: Fix async error handling - currently errors don't propagate correctly
        it.skip('should handle async errors', async () => {
            const input = collateral<{ shouldFail: boolean }>('input');
            const output = collateral<{ result: string }>('output');

            const errorNeuron = neuron('error', { output }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    const shouldFail = (payload as { shouldFail: boolean }).shouldFail;
                    await new Promise(resolve => setTimeout(resolve, 10));
                    
                    if (shouldFail) {
                        throw new Error('Intentional async error');
                    }
                    
                    return axon.output.createSignal({ result: 'success' });
                }
            });

            const cns = new CNS([errorNeuron]);

            // Test error case
            const errorPromise = cns.stimulate(input, { shouldFail: true });
            await expect(errorPromise).rejects.toThrow('Intentional async error');

            // Test success case
            const traces: Array<{ collateralId: string }> = [];
            const successPromise = cns.stimulate(input, { shouldFail: false }, {
                onTrace: trace => traces.push({ collateralId: trace.collateralId })
            });

            await successPromise;
            expect(traces).toHaveLength(2);
        });
    });

    describe('Parallel Processing', () => {
        it('should process multiple async branches in parallel', async () => {
            const input = collateral<{ data: string }>('input');
            const branchA = collateral<{ result: string; duration: number }>('branchA');
            const branchB = collateral<{ result: string; duration: number }>('branchB');
            const branchC = collateral<{ result: string; duration: number }>('branchC');

            const parallelProcessor = neuron('parallel', { branchA, branchB, branchC }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    const data = (payload as { data: string }).data;
                    const startTime = Date.now();

                    // Create first branch signal and return it, others will be handled via side effects
                    setTimeout(() => {
                        const duration = Date.now() - startTime;
                        axon.branchB.createSignal({ result: `branchB-${data}`, duration });
                    }, 20);
                    
                    setTimeout(() => {
                        const duration = Date.now() - startTime;
                        axon.branchC.createSignal({ result: `branchC-${data}`, duration });
                    }, 60);
                    
                    await new Promise(resolve => setTimeout(resolve, 40));
                    const duration = Date.now() - startTime;
                    return axon.branchA.createSignal({ result: `branchA-${data}`, duration });
                }
            });

            const cns = new CNS([parallelProcessor]);
            const traces: Array<{ collateralId: string; payload: unknown }> = [];
            const startTime = Date.now();

            const result = cns.stimulate(input, { data: 'parallel' }, {
                onTrace: trace => traces.push({ collateralId: trace.collateralId, payload: trace.payload })
            });

            await result;
            const totalTime = Date.now() - startTime;

            // Should complete in ~60ms (longest branch) not 120ms (sum of all)
            expect(totalTime).toBeGreaterThanOrEqual(60);
            expect(totalTime).toBeLessThan(120);

            expect(traces).toHaveLength(4); // input + 3 branches

            const branchATrace = traces.find(t => t.collateralId === 'branchA')?.payload as any;
            const branchBTrace = traces.find(t => t.collateralId === 'branchB')?.payload as any;
            const branchCTrace = traces.find(t => t.collateralId === 'branchC')?.payload as any;

            expect(branchATrace.result).toBe('branchA-parallel');
            expect(branchBTrace.result).toBe('branchB-parallel');
            expect(branchCTrace.result).toBe('branchC-parallel');

            // BranchB should complete first (shortest delay)
            expect(branchBTrace.duration).toBeLessThan(branchATrace.duration);
            expect(branchATrace.duration).toBeLessThan(branchCTrace.duration);
        });

        it('should handle parallel async processing', async () => {
            const input = collateral<{ data: string }>('input');
            const processed = collateral<{ id: number; result: string; timestamp: number }>('processed');

            // Create three separate neurons that respond to input
            const processor1 = neuron('processor1', { processed }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    const data = (payload as { data: string }).data;
                    await new Promise(resolve => setTimeout(resolve, 15));
                    return axon.processed.createSignal({ id: 1, result: `p1-${data}`, timestamp: Date.now() });
                }
            });

            const processor2 = neuron('processor2', { processed }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    const data = (payload as { data: string }).data;
                    await new Promise(resolve => setTimeout(resolve, 20));
                    return axon.processed.createSignal({ id: 2, result: `p2-${data}`, timestamp: Date.now() });
                }
            });

            const processor3 = neuron('processor3', { processed }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    const data = (payload as { data: string }).data;
                    await new Promise(resolve => setTimeout(resolve, 30));
                    return axon.processed.createSignal({ id: 3, result: `p3-${data}`, timestamp: Date.now() });
                }
            });

            const cns = new CNS([processor1, processor2, processor3]);
            const traces: Array<{ collateralId: string; payload: unknown }> = [];
            const startTime = Date.now();

            const result = cns.stimulate(input, { data: 'parallel' }, {
                onTrace: trace => traces.push({ collateralId: trace.collateralId, payload: trace.payload })
            });

            await result;
            const totalTime = Date.now() - startTime;

            // Should complete in ~30ms (longest processor) not 65ms (sum of all)
            expect(totalTime).toBeGreaterThanOrEqual(30);
            expect(totalTime).toBeLessThan(60);

            const processedTraces = traces.filter(t => t.collateralId === 'processed');
            expect(processedTraces).toHaveLength(3);
            expect(processedTraces.some(t => (t.payload as any).result.includes('p1-parallel'))).toBe(true);
            expect(processedTraces.some(t => (t.payload as any).result.includes('p2-parallel'))).toBe(true);
            expect(processedTraces.some(t => (t.payload as any).result.includes('p3-parallel'))).toBe(true);
        });
    });

    describe('Concurrency Control', () => {
        it('should respect concurrency limit of 1 (sequential)', async () => {
            const input = collateral<{ batch: number }>('input');
            const task = collateral<{ id: number }>('task');
            const result = collateral<{ id: number; startTime: number; endTime: number }>('result');

            let activeCount = 0;
            let maxActive = 0;

            // Create 4 separate neurons that all respond to input and generate tasks
            const gen1 = neuron('gen1', { task }).dendrite({
                collateral: input,
                response: (payload, axon) => axon.task.createSignal({ id: 1 })
            });
            const gen2 = neuron('gen2', { task }).dendrite({
                collateral: input,
                response: (payload, axon) => axon.task.createSignal({ id: 2 })
            });
            const gen3 = neuron('gen3', { task }).dendrite({
                collateral: input,
                response: (payload, axon) => axon.task.createSignal({ id: 3 })
            });
            const gen4 = neuron('gen4', { task }).dendrite({
                collateral: input,
                response: (payload, axon) => axon.task.createSignal({ id: 4 })
            });

            const worker = neuron('worker', { result }).dendrite({
                collateral: task,
                response: async (payload, axon) => {
                    const id = (payload as { id: number }).id;
                    const startTime = Date.now();
                    
                    activeCount++;
                    maxActive = Math.max(maxActive, activeCount);
                    
                    await new Promise(resolve => setTimeout(resolve, 30));
                    
                    activeCount--;
                    const endTime = Date.now();
                    
                    return axon.result.createSignal({ id, startTime, endTime });
                }
            });

            const cns = new CNS([gen1, gen2, gen3, gen4, worker]);
            const traces: Array<{ collateralId: string; payload: unknown }> = [];
            const startTime = Date.now();

            const promise = cns.stimulate(input, { batch: 1 }, {
                concurrency: 1,
                onTrace: trace => traces.push({ collateralId: trace.collateralId, payload: trace.payload })
            });

            await promise;
            const totalTime = Date.now() - startTime;

            // Sequential: 4 tasks * 30ms = ~120ms
            expect(totalTime).toBeGreaterThanOrEqual(110);
            expect(maxActive).toBe(1); // Never more than 1 concurrent

            const resultTraces = traces.filter(t => t.collateralId === 'result');
            expect(resultTraces).toHaveLength(4);
        });

        it('should respect concurrency limit of 2', async () => {
            const input = collateral<{ batch: number }>('input');
            const task = collateral<{ id: number }>('task');
            const result = collateral<{ id: number; processed: boolean }>('result');

            let activeCount = 0;
            let maxActive = 0;

            // Create 5 separate neurons that all respond to input and generate tasks
            const genA = neuron('genA', { task }).dendrite({ collateral: input, response: (_, axon) => axon.task.createSignal({ id: 1 }) });
            const genB = neuron('genB', { task }).dendrite({ collateral: input, response: (_, axon) => axon.task.createSignal({ id: 2 }) });
            const genC = neuron('genC', { task }).dendrite({ collateral: input, response: (_, axon) => axon.task.createSignal({ id: 3 }) });
            const genD = neuron('genD', { task }).dendrite({ collateral: input, response: (_, axon) => axon.task.createSignal({ id: 4 }) });
            const genE = neuron('genE', { task }).dendrite({ collateral: input, response: (_, axon) => axon.task.createSignal({ id: 5 }) });

            const worker = neuron('worker', { result }).dendrite({
                collateral: task,
                response: async (payload, axon) => {
                    const id = (payload as { id: number }).id;
                    
                    activeCount++;
                    maxActive = Math.max(maxActive, activeCount);
                    
                    await new Promise(resolve => setTimeout(resolve, 40));
                    
                    activeCount--;
                    
                    return axon.result.createSignal({ id, processed: true });
                }
            });

            const cns = new CNS([genA, genB, genC, genD, genE, worker]);
            const startTime = Date.now();

            const promise = cns.stimulate(input, { batch: 1 }, {
                concurrency: 2
            });

            await promise;
            const totalTime = Date.now() - startTime;

            // With concurrency 2: Wave1(2 items, 40ms) + Wave2(2 items, 40ms) + Wave3(1 item, 40ms) = ~120ms
            expect(totalTime).toBeGreaterThanOrEqual(110);
            expect(totalTime).toBeLessThan(200);
            expect(maxActive).toBeLessThanOrEqual(2);
            expect(maxActive).toBeGreaterThan(1);
        });

        it('should handle mixed sync/async with concurrency control', async () => {
            const input = collateral<{ items: number }>('input');
            const syncStep = collateral<{ id: number; synced: boolean }>('syncStep');
            const asyncStep = collateral<{ id: number; asynced: boolean }>('asyncStep');
            const final = collateral<{ id: number; complete: boolean }>('final');

            let asyncActiveCount = 0;
            let maxAsyncActive = 0;

            // Sync fan-out (immediate)
            const syncProcessor = neuron('sync', { syncStep }).dendrite({
                collateral: input,
                response: (payload, axon) => {
                    const items = (payload as { items: number }).items;
                    // Create additional signals via side effects
                    for (let i = 1; i < items; i++) {
                        axon.syncStep.createSignal({ id: i + 1, synced: true });
                    }
                    // Return the first signal
                    return axon.syncStep.createSignal({ id: 1, synced: true });
                }
            });

            // Async processing (respects concurrency)
            const asyncProcessor = neuron('async', { asyncStep }).dendrite({
                collateral: syncStep,
                response: async (payload, axon) => {
                    const { id } = payload as { id: number; synced: boolean };
                    
                    asyncActiveCount++;
                    maxAsyncActive = Math.max(maxAsyncActive, asyncActiveCount);
                    
                    await new Promise(resolve => setTimeout(resolve, 25));
                    
                    asyncActiveCount--;
                    
                    return axon.asyncStep.createSignal({ id, asynced: true });
                }
            });

            // Sync final step (immediate)
            const finalProcessor = neuron('final', { final }).dendrite({
                collateral: asyncStep,
                response: (payload, axon) => {
                    const { id } = payload as { id: number; asynced: boolean };
                    return axon.final.createSignal({ id, complete: true });
                }
            });

            const cns = new CNS([syncProcessor, asyncProcessor, finalProcessor]);
            const traces: Array<{ collateralId: string }> = [];
            const startTime = Date.now();

            const promise = cns.stimulate(input, { items: 3 }, {
                concurrency: 2,
                onTrace: trace => traces.push({ collateralId: trace.collateralId })
            });

            await promise;
            const totalTime = Date.now() - startTime;

            // 3 async items with concurrency 2: ~50ms (25ms * 2 waves)
            expect(totalTime).toBeGreaterThanOrEqual(40);
            expect(totalTime).toBeLessThan(100);
            expect(maxAsyncActive).toBeLessThanOrEqual(2);

            expect(traces.filter(t => t.collateralId === 'syncStep')).toHaveLength(3);
            expect(traces.filter(t => t.collateralId === 'asyncStep')).toHaveLength(3);
            expect(traces.filter(t => t.collateralId === 'final')).toHaveLength(3);
        });
    });

    describe('Complex Async Scenarios', () => {
        it('should handle async diamond pattern', async () => {
            const input = collateral<{ value: number }>('input');
            const leftPath = collateral<{ value: number }>('leftPath');
            const rightPath = collateral<{ value: number }>('rightPath');
            const merge = collateral<{ leftValue: number; rightValue: number; sum: number }>('merge');

            // Left processor
            const leftProcessor = neuron('left', { leftPath }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    const value = (payload as { value: number }).value;
                    await new Promise(resolve => setTimeout(resolve, 20));
                    return axon.leftPath.createSignal({ value: value * 2 });
                }
            });

            // Right processor
            const rightProcessor = neuron('right', { rightPath }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    const value = (payload as { value: number }).value;
                    await new Promise(resolve => setTimeout(resolve, 30));
                    return axon.rightPath.createSignal({ value: value * 3 });
                }
            });

            // Merge processor using context to accumulate values with proper typing
            type MergeContext = { leftValue?: number; rightValue?: number };
            
            const merger = withCtx<MergeContext>().neuron('merger', { merge })
                .dendrite({
                    collateral: leftPath,
                    response: (payload, axon, ctx) => {
                        const leftValue = (payload as { value: number }).value;
                        const current = ctx.get() || {};
                        const updated = { ...current, leftValue };
                        ctx.set(updated);
                        
                        // Check if we have both values
                        if (updated.rightValue !== undefined) {
                            const sum = updated.leftValue + updated.rightValue;
                            return axon.merge.createSignal({ 
                                leftValue: updated.leftValue, 
                                rightValue: updated.rightValue, 
                                sum 
                            });
                        }
                        
                        // Not ready yet, return nothing
                        return undefined;
                    }
                })
                .dendrite({
                    collateral: rightPath,
                    response: (payload, axon, ctx) => {
                        const rightValue = (payload as { value: number }).value;
                        const current = ctx.get() || {};
                        const updated = { ...current, rightValue };
                        ctx.set(updated);
                        
                        // Check if we have both values
                        if (updated.leftValue !== undefined) {
                            const sum = updated.leftValue + updated.rightValue;
                            return axon.merge.createSignal({ 
                                leftValue: updated.leftValue, 
                                rightValue: updated.rightValue, 
                                sum 
                            });
                        }
                        
                        // Not ready yet, return nothing
                        return undefined;
                    }
                });

            const cns = new CNS([leftProcessor, rightProcessor, merger]);
            const traces: Array<{ collateralId: string; payload: unknown }> = [];
            const startTime = Date.now();

            const result = cns.stimulate(input, { value: 10 }, {
                onTrace: trace => traces.push({ collateralId: trace.collateralId, payload: trace.payload })
            });

            await result;
            const totalTime = Date.now() - startTime;

            // Should complete when both branches finish (~30ms for the slower right branch)
            expect(totalTime).toBeGreaterThanOrEqual(20);
            expect(totalTime).toBeLessThan(60);

            // Should have exactly one merge result with sum
            const mergeTraces = traces.filter(t => t.collateralId === 'merge');
            expect(mergeTraces).toHaveLength(1);
            expect((mergeTraces[0].payload as any).sum).toBe(50); // (10*2) + (10*3)
        });

        it('should handle async timing differences', async () => {
            const input = collateral<{ data: string }>('input');
            const fastResult = collateral<{ result: string }>('fastResult');
            const slowResult = collateral<{ result: string }>('slowResult');

            // Two separate neurons with different timing
            const fastProcessor = neuron('fast', { fastResult }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    const data = (payload as { data: string }).data;
                    await new Promise(resolve => setTimeout(resolve, 20));
                    return axon.fastResult.createSignal({ result: `fast-${data}` });
                }
            });

            const slowProcessor = neuron('slow', { slowResult }).dendrite({
                collateral: input,
                response: async (payload, axon) => {
                    const data = (payload as { data: string }).data;
                    await new Promise(resolve => setTimeout(resolve, 80));
                    return axon.slowResult.createSignal({ result: `slow-${data}` });
                }
            });

            const cns = new CNS([fastProcessor, slowProcessor]);

            const traces: Array<{ collateralId: string; payload: unknown }> = [];
            const startTime = Date.now();
            
            const result = cns.stimulate(input, { data: 'test' }, {
                onTrace: trace => traces.push({ collateralId: trace.collateralId, payload: trace.payload })
            });

            await result;
            const totalTime = Date.now() - startTime;

            // Should wait for both to complete (~80ms total)
            expect(totalTime).toBeGreaterThanOrEqual(70);
            expect(traces).toHaveLength(3); // input + fast + slow
            expect(traces.find(t => t.collateralId === 'fastResult')).toBeDefined();
            expect(traces.find(t => t.collateralId === 'slowResult')).toBeDefined();
        });

        it('should handle async chain processing', async () => {
            const trigger = collateral<{ value: number }>('trigger');
            const level1 = collateral<{ value: number }>('level1');
            const level2 = collateral<{ value: number }>('level2');
            const level3 = collateral<{ value: number }>('level3');

            const processor1 = neuron('proc1', { level1 }).dendrite({
                collateral: trigger,
                response: async (payload, axon) => {
                    const value = (payload as { value: number }).value;
                    await new Promise(resolve => setTimeout(resolve, 15));
                    return axon.level1.createSignal({ value: value * 2 });
                }
            });

            const processor2 = neuron('proc2', { level2 }).dendrite({
                collateral: level1,
                response: async (payload, axon) => {
                    const value = (payload as { value: number }).value;
                    await new Promise(resolve => setTimeout(resolve, 10));
                    return axon.level2.createSignal({ value: value + 10 });
                }
            });

            const processor3 = neuron('proc3', { level3 }).dendrite({
                collateral: level2,
                response: async (payload, axon) => {
                    const value = (payload as { value: number }).value;
                    await new Promise(resolve => setTimeout(resolve, 8));
                    return axon.level3.createSignal({ value: value * 3 });
                }
            });

            const cns = new CNS([processor1, processor2, processor3]);
            const traces: Array<{ collateralId: string; payload: unknown }> = [];
            const startTime = Date.now();

            const result = cns.stimulate(trigger, { value: 5 }, {
                onTrace: trace => traces.push({ collateralId: trace.collateralId, payload: trace.payload })
            });

            await result;
            const totalTime = Date.now() - startTime;

            // Should take 15 + 10 + 8 = 33ms minimum
            expect(totalTime).toBeGreaterThanOrEqual(33);
            
            expect(traces).toHaveLength(4); // trigger + level1 + level2 + level3
            expect(traces[3]).toMatchObject({ collateralId: 'level3', payload: { value: 60 } }); // ((5*2)+10)*3
        });
    });
});