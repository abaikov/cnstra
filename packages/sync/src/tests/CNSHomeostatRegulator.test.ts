import { CNS } from '@cnstra/core';
import {
    CNSHomeostatFiringPolicy,
    CNSHomeostatReceptor,
    CNSHomeostatReceptorCorrection,
    CNSHomeostatStaleTimeRefetchPolicy,
    CNSHomeostatRegulator,
    ECNSHomeostatCorrectionStatus,
} from '../index';
import type { ICNSHomeostatCorrectionRepository, TCNSHomeostatCorrectionState, TCNSHomeostatSource } from '../index';
import { cnsAt } from './support/cnsHomeostatTestSupport';

type TKey = readonly [deckId: string];

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const createWorld = () => {
    const records = new Map<string, TCNSHomeostatCorrectionState<TKey>>();
    const homeostatCorrectionRepository: ICNSHomeostatCorrectionRepository<TKey> = {
        peekHomeostatCorrectionState: keyHash => records.get(keyHash),
        writeHomeostatCorrectionState: (keyHash, homeostatCorrectionState) => { records.set(keyHash, homeostatCorrectionState); },
        holdHomeostatCorrectionState: () => undefined,
        unholdHomeostatCorrectionState: keyHash => { records.delete(keyHash); },
    };
    const server = { requested: [] as string[], hang: false, answers: [] as (() => void)[] };
    const deckReceptor = new CNSHomeostatReceptor<TKey, { id: string }>({ name: 'deck' });
    const homeostatCorrection = new CNSHomeostatReceptorCorrection({ homeostatReceptors: [deckReceptor] });
    const cns = new CNS([deckReceptor.neuron, homeostatCorrection.neuron]);
    const refetches: (() => void)[] = [];
    const deckRegulator = new CNSHomeostatRegulator<TKey, { id: string }>({
        homeostatReceptor: deckReceptor,
        cns,
        homeostatCorrectionRepository,
        homeostatFiringPolicy: new CNSHomeostatFiringPolicy(),
        homeostatRefetchPolicy: new CNSHomeostatStaleTimeRefetchPolicy({ staleTimeMs: 5_000 }),
        stimulationOptions: undefined,
        getNowMs: () => 1_000,
        keyHashFn: key => JSON.stringify(key),
        runUntracked: run => queueMicrotask(run),
        runInTransaction: run => run(),
        scheduleRefetchAt: (_keyHash, _refetchAtMs, refetch) => { refetches.push(refetch); },
    });
    const sourceOf = (deckId: string): TCNSHomeostatSource<TKey, { id: string }> => ({
        key: [deckId],
        transduce: abortSignal => {
            server.requested.push(deckId);
            if (!server.hang) return Promise.resolve({ id: deckId });
            return new Promise((resolve, reject) => {
                server.answers.push(() => resolve({ id: deckId }));
                abortSignal.addEventListener('abort', () => reject(abortSignal.reason));
            });
        },
    });
    const watch = (source: TCNSHomeostatSource<TKey, { id: string }>, isObserved = true) => {
        const homeostasisQuery = deckRegulator.createHomeostasisQuery(undefined, undefined, isObserved);
        const read = () => deckRegulator.regulate(homeostasisQuery, source, homeostatCorrectionRepository.peekHomeostatCorrectionState(JSON.stringify(source.key)));
        return { homeostasisQuery, read, release: () => deckRegulator.release(homeostasisQuery) };
    };
    return { deckRegulator, records, refetches, server, sourceOf, watch };
};

describe('the regulator without any state manager', () => {
    it('works out Firing for a query nobody observes and sends its request only when it is observed', async () => {
        const world = createWorld();
        const deck = world.watch(world.sourceOf('d1'), false);
        expect(deck.read().status).toBe(ECNSHomeostatCorrectionStatus.Firing);
        await settle();
        expect(world.server.requested).toEqual([]);
        world.deckRegulator.observe(deck.homeostasisQuery);
        world.deckRegulator.observe(deck.homeostasisQuery);
        await settle();
        expect(world.server.requested).toEqual(['d1']);
    });

    it('sends nothing for a query nobody observed before it was released', async () => {
        const world = createWorld();
        const deck = world.watch(world.sourceOf('d1'), false);
        deck.read();
        deck.release();
        await settle();
        expect(world.server.requested).toEqual([]);
    });

    it('starts the request a query nobody observes is waiting on when an observed query of the same key joins it', async () => {
        const world = createWorld();
        world.server.hang = true;
        const unobserved = world.watch(world.sourceOf('d1'), false);
        const observed = world.watch(world.sourceOf('d1'));
        unobserved.read();
        expect(observed.read().homeostatRunningFiring).toBe(unobserved.homeostasisQuery.homeostatRunningFiring);
        await settle();
        expect(world.server.requested).toEqual(['d1']);
    });

    it('never starts a request that was superseded inside the same derivation', async () => {
        const world = createWorld();
        const homeostasisQuery = world.deckRegulator.createHomeostasisQuery();
        world.deckRegulator.regulate(homeostasisQuery, world.sourceOf('d1'), undefined);
        world.deckRegulator.regulate(homeostasisQuery, world.sourceOf('d1'), undefined);
        await settle();
        expect(world.server.requested).toEqual(['d1']);
    });

    it('schedules one refetch for a key that several queries settle on', async () => {
        const world = createWorld();
        const decks = [world.watch(world.sourceOf('d1')), world.watch(world.sourceOf('d1')), world.watch(world.sourceOf('d1'))];
        for (const deck of decks) deck.read();
        await settle();
        for (const deck of decks) deck.read();
        expect(world.refetches).toHaveLength(1);
    });

    it('schedules again when the refetch runs before its time on the regulator clock', async () => {
        const world = createWorld();
        const deck = world.watch(world.sourceOf('d1'));
        deck.read();
        await settle();
        deck.read();
        expect(world.refetches).toHaveLength(1);
        cnsAt(world.refetches, 0)();
        expect(world.refetches).toHaveLength(2);
        expect(world.records.get('["d1"]')).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored });
    });

    it('keeps the running request of a key when a query reads a new source of the same key', async () => {
        const world = createWorld();
        world.server.hang = true;
        const first = world.deckRegulator.createHomeostasisQuery();
        const second = world.watch(world.sourceOf('d1'));
        const readFirst = (source: TCNSHomeostatSource<TKey, { id: string }>) =>
            world.deckRegulator.regulate(first, source, world.records.get('["d1"]'));
        readFirst(world.sourceOf('d1'));
        expect(second.read()).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Firing, firingNumber: 1 });
        expect(readFirst(world.sourceOf('d1'))).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Firing, firingNumber: 1 });
        await settle();
        expect(world.server.requested).toEqual(['d1']);
        cnsAt(world.server.answers, 0)();
        await settle();
        expect(readFirst(world.sourceOf('d1'))).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 1 });
        expect(second.read()).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Restored, firingNumber: 1 });
        expect(world.server.requested).toEqual(['d1']);
        world.deckRegulator.release(first);
        second.release();
    });

    it('rejects the wait of a running request whose last reader leaves with the released reason', async () => {
        const world = createWorld();
        world.server.hang = true;
        const deck = world.watch(world.sourceOf('d1'));
        const firing = deck.read();
        await settle();
        const settled = firing.homeostatRunningFiring?.waitUntilSettled();

        deck.release();

        await expect(settled).rejects.toMatchObject({ name: 'AbortError', message: 'homeostat request released' });
    });

    it('aborts the running request, settles the invalidate waiter and fires nothing after dispose', async () => {
        const world = createWorld();
        const deck = world.watch(world.sourceOf('d1'));
        deck.read();
        await settle();
        deck.read();
        world.server.hang = true;
        const invalidated = world.deckRegulator.invalidate(['d1']);
        const firing = deck.read();
        expect(firing).toMatchObject({ status: ECNSHomeostatCorrectionStatus.Firing, firingNumber: 2 });
        await settle();
        expect(world.server.requested).toEqual(['d1', 'd1']);
        const settled = firing.homeostatRunningFiring?.waitUntilSettled();
        expect(world.records.has('["d1"]')).toBe(true);
        world.deckRegulator.dispose();
        expect(world.records.has('["d1"]')).toBe(false);
        await expect(invalidated).resolves.toBeUndefined();
        await expect(settled).rejects.toMatchObject({ name: 'AbortError', message: 'homeostat request disposed' });
        cnsAt(world.refetches, 0)();
        await settle();
        expect(deck.read()).toBe(firing);
        await expect(world.deckRegulator.invalidate(['d1'])).resolves.toBeUndefined();
        await settle();
        expect(world.server.requested).toEqual(['d1', 'd1']);
        expect(world.records.has('["d1"]')).toBe(false);
        deck.release();
    });

    it('identifies a source by its whole key, a key of two parts included, and computes the id once per key object', () => {
        const keyHashes: string[] = [];
        const pageRegulator = new CNSHomeostatRegulator<readonly [deckId: string, page: number], { id: string }>({
            homeostatReceptor: new CNSHomeostatReceptor<readonly [deckId: string, page: number], { id: string }>({ name: 'page' }),
            cns: new CNS([]),
            homeostatCorrectionRepository: { peekHomeostatCorrectionState: () => undefined, writeHomeostatCorrectionState: () => undefined, holdHomeostatCorrectionState: () => undefined, unholdHomeostatCorrectionState: () => undefined },
            homeostatFiringPolicy: new CNSHomeostatFiringPolicy(),
            homeostatRefetchPolicy: new CNSHomeostatStaleTimeRefetchPolicy({ staleTimeMs: Infinity }),
            stimulationOptions: undefined,
            getNowMs: () => 0,
            keyHashFn: key => {
                const keyHash = JSON.stringify(key);
                keyHashes.push(keyHash);
                return keyHash;
            },
            runUntracked: run => run(),
            runInTransaction: run => run(),
            scheduleRefetchAt: () => undefined,
        });
        const homeostasisQuery = pageRegulator.createHomeostasisQuery();
        const homeostatSource = { key: ['d1', 2] as const, transduce: () => Promise.resolve({ id: 'd1' }) };
        expect(pageRegulator.homeostatSourceKeyHashOf(homeostasisQuery, homeostatSource)).toBe('["d1",2]');
        expect(pageRegulator.homeostatSourceKeyHashOf(homeostasisQuery, homeostatSource)).toBe('["d1",2]');
        expect(keyHashes).toEqual(['["d1",2]']);
    });

    it('refuses a stale time that is not above zero, which would refetch as fast as the answers come', () => {
        expect(() => new CNSHomeostatStaleTimeRefetchPolicy({ staleTimeMs: 0 })).toThrow('staleTimeMs 0 would refetch as fast as the answers come');
        expect(() => new CNSHomeostatStaleTimeRefetchPolicy({ staleTimeMs: -5 })).toThrow('staleTimeMs -5');
        expect(() => new CNSHomeostatStaleTimeRefetchPolicy({ staleTimeMs: 1_000, homeostatRefractoryPolicy: { initialDelayMs: 0, multiplier: 2, maxDelayMs: 1_000 } })).toThrow('initialDelayMs 0 would ask a failing key again as fast as it fails');
    });
});
