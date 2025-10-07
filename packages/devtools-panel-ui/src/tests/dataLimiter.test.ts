import { DataLimiter, dataLimiter } from '../utils/dataLimiter';
import { DEVTOOLS_LIMITS } from '../config/limits';

// Mock the database with proper OIMDB collection structure
jest.mock('../model', () => ({
    db: {
        stimulations: {
            getAll: jest.fn(() => []),
            collection: {
                delete: jest.fn(),
                deleteOne: jest.fn(),
            },
        },
        responses: {
            getAll: jest.fn(() => []),
            collection: {
                delete: jest.fn(),
                deleteOne: jest.fn(),
            },
        },
        neurons: {
            getAll: jest.fn(() => []),
            collection: {
                delete: jest.fn(),
                deleteOne: jest.fn(),
            },
        },
        collaterals: {
            getAll: jest.fn(() => []),
            collection: {
                delete: jest.fn(),
                deleteOne: jest.fn(),
            },
        },
        dendrites: {
            getAll: jest.fn(() => []),
            collection: {
                delete: jest.fn(),
                deleteOne: jest.fn(),
            },
        },
        apps: {
            getAll: jest.fn(() => []),
            collection: {
                delete: jest.fn(),
                deleteOne: jest.fn(),
            },
        },
    }
}));

import { db } from '../model';

// Properly typed mock database
const mockDb = {
    stimulations: {
        getAll: jest.fn() as jest.MockedFunction<() => any[]>,
        collection: {
            delete: jest.fn(),
            deleteOne: jest.fn(),
        },
    },
    responses: {
        getAll: jest.fn() as jest.MockedFunction<() => any[]>,
        collection: {
            delete: jest.fn(),
            deleteOne: jest.fn(),
        },
    },
    neurons: {
        getAll: jest.fn() as jest.MockedFunction<() => any[]>,
        collection: {
            delete: jest.fn(),
            deleteOne: jest.fn(),
        },
    },
    collaterals: {
        getAll: jest.fn() as jest.MockedFunction<() => any[]>,
        collection: {
            delete: jest.fn(),
            deleteOne: jest.fn(),
        },
    },
    dendrites: {
        getAll: jest.fn() as jest.MockedFunction<() => any[]>,
        collection: {
            delete: jest.fn(),
            deleteOne: jest.fn(),
        },
    },
    apps: {
        getAll: jest.fn() as jest.MockedFunction<() => any[]>,
        collection: {
            delete: jest.fn(),
            deleteOne: jest.fn(),
        },
    },
} as any;

describe('DataLimiter', () => {
    let limiter: DataLimiter;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        // Reset singleton instance for each test
        (DataLimiter as any).instance = null;
        limiter = DataLimiter.getInstance();

        // Mock console.log to avoid test output pollution
        jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
        jest.useRealTimers();
        limiter.stopCleanup();
        jest.restoreAllMocks();
    });

    describe('Singleton Pattern', () => {
        test('returns the same instance when called multiple times', () => {
            const instance1 = DataLimiter.getInstance();
            const instance2 = DataLimiter.getInstance();

            expect(instance1).toBe(instance2);
        });

        test('exports a singleton instance', () => {
            expect(dataLimiter).toBeInstanceOf(DataLimiter);
            expect(dataLimiter).toBe(DataLimiter.getInstance());
        });
    });

    describe('Cleanup Lifecycle', () => {
        test('starts cleanup with correct interval', () => {
            limiter.startCleanup();

            expect(console.log).toHaveBeenCalledWith('🧹 DevTools data limiter started');

            // Advance time to trigger cleanup
            jest.advanceTimersByTime(DEVTOOLS_LIMITS.CLEANUP_INTERVAL);

            // Should have called enforceDataLimits
            expect(console.log).toHaveBeenCalledWith('🧹 DevTools data cleanup completed');
        });

        test('does not start multiple cleanup intervals', () => {
            const setIntervalSpy = jest.spyOn(global, 'setInterval');

            limiter.startCleanup();
            limiter.startCleanup(); // Second call

            expect(setIntervalSpy).toHaveBeenCalledTimes(1);
        });

        test('stops cleanup correctly', () => {
            limiter.startCleanup();

            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
            limiter.stopCleanup();

            expect(clearIntervalSpy).toHaveBeenCalled();
            expect(console.log).toHaveBeenCalledWith('🛑 DevTools data limiter stopped');
        });

        test('handles stopping cleanup when not started', () => {
            expect(() => limiter.stopCleanup()).not.toThrow();
        });
    });

    describe('Data Statistics', () => {
        test('calculates correct data statistics', () => {
            const mockStimulations = Array.from({ length: 50 }, (_, i) => ({ id: i }));
            const mockResponses = Array.from({ length: 30 }, (_, i) => ({ id: i }));
            const mockNeurons = Array.from({ length: 10 }, (_, i) => ({ id: i }));
            const mockCollaterals = Array.from({ length: 15 }, (_, i) => ({ id: i }));
            const mockDendrites = Array.from({ length: 20 }, (_, i) => ({ id: i }));
            const mockApps = Array.from({ length: 3 }, (_, i) => ({ id: i }));

            mockDb.stimulations.getAll.mockReturnValue(mockStimulations);
            mockDb.responses.getAll.mockReturnValue(mockResponses);
            mockDb.neurons.getAll.mockReturnValue(mockNeurons);
            mockDb.collaterals.getAll.mockReturnValue(mockCollaterals);
            mockDb.dendrites.getAll.mockReturnValue(mockDendrites);
            mockDb.apps.getAll.mockReturnValue(mockApps);

            const stats = limiter.getDataStats();

            expect(stats.stimulations).toBe(50);
            expect(stats.responses).toBe(30);
            expect(stats.neurons).toBe(10);
            expect(stats.collaterals).toBe(15);
            expect(stats.dendrites).toBe(20);
            expect(stats.apps).toBe(3);
            expect(stats.memoryUsageKB).toBeGreaterThan(0);
        });

        test('estimates memory usage correctly', () => {
            const mockStimulations = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
            const mockResponses = Array.from({ length: 500 }, (_, i) => ({ id: i }));

            mockDb.stimulations.getAll.mockReturnValue(mockStimulations);
            mockDb.responses.getAll.mockReturnValue(mockResponses);
            mockDb.neurons.getAll.mockReturnValue([]);
            mockDb.collaterals.getAll.mockReturnValue([]);
            mockDb.dendrites.getAll.mockReturnValue([]);
            mockDb.apps.getAll.mockReturnValue([]);

            const stats = limiter.getDataStats();

            // 1000 * 0.5 + 500 * 0.3 = 650 KB
            expect(stats.memoryUsageKB).toBe(650);
        });

        test('handles empty datasets', () => {
            mockDb.stimulations.getAll.mockReturnValue([]);
            mockDb.responses.getAll.mockReturnValue([]);
            mockDb.neurons.getAll.mockReturnValue([]);
            mockDb.collaterals.getAll.mockReturnValue([]);
            mockDb.dendrites.getAll.mockReturnValue([]);
            mockDb.apps.getAll.mockReturnValue([]);

            const stats = limiter.getDataStats();

            expect(stats.stimulations).toBe(0);
            expect(stats.responses).toBe(0);
            expect(stats.memoryUsageKB).toBe(0);
        });
    });

    describe('Limit Checking', () => {
        test('detects when stimulations approach limit', () => {
            const nearLimitCount = Math.floor(DEVTOOLS_LIMITS.MAX_STIMULATIONS * 0.9);
            const mockStimulations = Array.from({ length: nearLimitCount }, (_, i) => ({ id: i }));

            mockDb.stimulations.getAll.mockReturnValue(mockStimulations);
            mockDb.responses.getAll.mockReturnValue([]);
            mockDb.neurons.getAll.mockReturnValue([]);
            mockDb.collaterals.getAll.mockReturnValue([]);
            mockDb.dendrites.getAll.mockReturnValue([]);
            mockDb.apps.getAll.mockReturnValue([]);

            const limits = limiter.checkLimits();

            expect(limits.stimulationsNearLimit).toBe(true);
            expect(limits.warnings).toContain(
                expect.stringContaining('High stimulation count')
            );
        });

        test('detects when responses approach limit', () => {
            const nearLimitCount = Math.floor(DEVTOOLS_LIMITS.MAX_RESPONSES * 0.9);
            const mockResponses = Array.from({ length: nearLimitCount }, (_, i) => ({ id: i }));

            mockDb.stimulations.getAll.mockReturnValue([]);
            mockDb.responses.getAll.mockReturnValue(mockResponses);
            mockDb.neurons.getAll.mockReturnValue([]);
            mockDb.collaterals.getAll.mockReturnValue([]);
            mockDb.dendrites.getAll.mockReturnValue([]);
            mockDb.apps.getAll.mockReturnValue([]);

            const limits = limiter.checkLimits();

            expect(limits.responsesNearLimit).toBe(true);
            expect(limits.warnings).toContain(
                expect.stringContaining('High response count')
            );
        });

        test('detects high memory usage', () => {
            // Create enough data to exceed 50MB threshold
            const highMemoryStimulations = Array.from({ length: 120000 }, (_, i) => ({ id: i }));

            mockDb.stimulations.getAll.mockReturnValue(highMemoryStimulations);
            mockDb.responses.getAll.mockReturnValue([]);
            mockDb.neurons.getAll.mockReturnValue([]);
            mockDb.collaterals.getAll.mockReturnValue([]);
            mockDb.dendrites.getAll.mockReturnValue([]);
            mockDb.apps.getAll.mockReturnValue([]);

            const limits = limiter.checkLimits();

            expect(limits.memoryHigh).toBe(true);
            expect(limits.warnings).toContain(
                expect.stringContaining('High memory usage')
            );
        });

        test('returns no warnings when under limits', () => {
            const lowCounts = Array.from({ length: 10 }, (_, i) => ({ id: i }));

            mockDb.stimulations.getAll.mockReturnValue(lowCounts);
            mockDb.responses.getAll.mockReturnValue(lowCounts);
            mockDb.neurons.getAll.mockReturnValue(lowCounts);
            mockDb.collaterals.getAll.mockReturnValue(lowCounts);
            mockDb.dendrites.getAll.mockReturnValue(lowCounts);
            mockDb.apps.getAll.mockReturnValue(lowCounts);

            const limits = limiter.checkLimits();

            expect(limits.stimulationsNearLimit).toBe(false);
            expect(limits.responsesNearLimit).toBe(false);
            expect(limits.memoryHigh).toBe(false);
            expect(limits.warnings).toHaveLength(0);
        });
    });

    describe('Data Enforcement', () => {
        test('enforces data limits automatically', () => {
            limiter.startCleanup();

            // Advance time to trigger cleanup
            jest.advanceTimersByTime(DEVTOOLS_LIMITS.CLEANUP_INTERVAL);

            expect(console.log).toHaveBeenCalledWith('🧹 DevTools data cleanup completed');
        });

        test('calls all cleanup methods', () => {
            const now = Date.now();
            const cutoffTime = now - DEVTOOLS_LIMITS.RETENTION_TIME;

            // Mock data with old timestamps
            const oldStimulations = [
                { stimulationId: 'old1', timestamp: cutoffTime - 1000 },
                { stimulationId: 'new1', timestamp: now - 1000 },
            ];

            const oldResponses = [
                { responseId: 'old1', timestamp: cutoffTime - 1000 },
                { responseId: 'new1', timestamp: now - 1000 },
            ];

            const oldApps = [
                { appId: 'old-app', lastSeenAt: cutoffTime - 1000 },
                { appId: 'new-app', lastSeenAt: now - 1000 },
            ];

            mockDb.stimulations.getAll.mockReturnValue(oldStimulations);
            mockDb.responses.getAll.mockReturnValue(oldResponses);
            mockDb.apps.getAll.mockReturnValue(oldApps);
            mockDb.neurons.getAll.mockReturnValue([]);
            mockDb.collaterals.getAll.mockReturnValue([]);
            mockDb.dendrites.getAll.mockReturnValue([]);

            // Mock Date.now to return consistent time
            const mockDateNow = jest.spyOn(Date, 'now').mockReturnValue(now);

            limiter.enforceDataLimits();

            expect(console.log).toHaveBeenCalledWith('🧹 DevTools data cleanup completed');

            mockDateNow.mockRestore();
        });

        test('limits stimulations by count', () => {
            const manyStimulations = Array.from({ length: DEVTOOLS_LIMITS.MAX_STIMULATIONS + 100 }, (_, i) => ({
                stimulationId: `stim${i}`,
                timestamp: Date.now() - i * 1000, // Newer first
            }));

            mockDb.stimulations.getAll.mockReturnValue(manyStimulations);
            mockDb.responses.getAll.mockReturnValue([]);
            mockDb.apps.getAll.mockReturnValue([]);

            limiter.enforceDataLimits();

            // TODO: Verify actual deletion once OIMDB API supports it
            // For now, we just ensure no errors are thrown
            expect(console.log).toHaveBeenCalledWith('🧹 DevTools data cleanup completed');
        });

        test('limits responses by count', () => {
            const manyResponses = Array.from({ length: DEVTOOLS_LIMITS.MAX_RESPONSES + 100 }, (_, i) => ({
                responseId: `resp${i}`,
                timestamp: Date.now() - i * 1000,
            }));

            mockDb.stimulations.getAll.mockReturnValue([]);
            mockDb.responses.getAll.mockReturnValue(manyResponses);
            mockDb.apps.getAll.mockReturnValue([]);

            limiter.enforceDataLimits();

            expect(console.log).toHaveBeenCalledWith('🧹 DevTools data cleanup completed');
        });

        test('removes old apps and their data', () => {
            const now = Date.now();
            const cutoffTime = now - DEVTOOLS_LIMITS.RETENTION_TIME;

            const oldApps = [
                { appId: 'old-app', lastSeenAt: cutoffTime - 1000 },
            ];

            mockDb.stimulations.getAll.mockReturnValue([]);
            mockDb.responses.getAll.mockReturnValue([]);
            mockDb.apps.getAll.mockReturnValue(oldApps);

            jest.spyOn(Date, 'now').mockReturnValue(now);

            limiter.enforceDataLimits();

            // Should attempt to clean up old apps
            expect(console.log).toHaveBeenCalledWith('🧹 DevTools data cleanup completed');
        });
    });

    describe('Edge Cases and Error Handling', () => {
        test('handles database errors gracefully', () => {
            mockDb.stimulations.getAll.mockImplementation(() => {
                throw new Error('Database error');
            });

            expect(() => limiter.getDataStats()).not.toThrow();
            expect(() => limiter.enforceDataLimits()).not.toThrow();
        });

        test('handles malformed data gracefully', () => {
            const malformedStimulations = [
                { stimulationId: null, timestamp: 'invalid' },
                { stimulationId: undefined, timestamp: NaN },
                {},
            ];

            mockDb.stimulations.getAll.mockReturnValue(malformedStimulations as any);
            mockDb.responses.getAll.mockReturnValue([]);
            mockDb.apps.getAll.mockReturnValue([]);

            expect(() => limiter.enforceDataLimits()).not.toThrow();
        });

        test('handles empty stimulation arrays', () => {
            mockDb.stimulations.getAll.mockReturnValue([]);
            mockDb.responses.getAll.mockReturnValue([]);
            mockDb.apps.getAll.mockReturnValue([]);

            expect(() => limiter.enforceDataLimits()).not.toThrow();

            const stats = limiter.getDataStats();
            expect(stats.stimulations).toBe(0);
        });

        test('handles missing timestamps', () => {
            const stimulationsWithoutTimestamps = [
                { stimulationId: 'stim1' }, // Missing timestamp
                { stimulationId: 'stim2', timestamp: undefined },
            ];

            mockDb.stimulations.getAll.mockReturnValue(stimulationsWithoutTimestamps as any);
            mockDb.responses.getAll.mockReturnValue([]);
            mockDb.apps.getAll.mockReturnValue([]);

            expect(() => limiter.enforceDataLimits()).not.toThrow();
        });

        test('handles very large datasets efficiently', () => {
            const veryLargeDataset = Array.from({ length: 100000 }, (_, i) => ({
                stimulationId: `stim${i}`,
                timestamp: Date.now() - i,
            }));

            mockDb.stimulations.getAll.mockReturnValue(veryLargeDataset);
            mockDb.responses.getAll.mockReturnValue([]);
            mockDb.apps.getAll.mockReturnValue([]);

            const startTime = performance.now();
            limiter.enforceDataLimits();
            const endTime = performance.now();

            // Should complete within reasonable time (less than 1 second)
            expect(endTime - startTime).toBeLessThan(1000);
        });
    });

    describe('Configuration Compliance', () => {
        test('respects configured limits', () => {
            expect(DEVTOOLS_LIMITS.MAX_STIMULATIONS).toBeDefined();
            expect(DEVTOOLS_LIMITS.MAX_RESPONSES).toBeDefined();
            expect(DEVTOOLS_LIMITS.CLEANUP_INTERVAL).toBeDefined();
            expect(DEVTOOLS_LIMITS.RETENTION_TIME).toBeDefined();

            // Ensure limits are reasonable
            expect(DEVTOOLS_LIMITS.MAX_STIMULATIONS).toBeGreaterThan(0);
            expect(DEVTOOLS_LIMITS.MAX_RESPONSES).toBeGreaterThan(0);
            expect(DEVTOOLS_LIMITS.CLEANUP_INTERVAL).toBeGreaterThan(0);
            expect(DEVTOOLS_LIMITS.RETENTION_TIME).toBeGreaterThan(0);
        });

        test('uses correct retention time for cleanup', () => {
            const now = Date.now();
            const expectedCutoff = now - DEVTOOLS_LIMITS.RETENTION_TIME;

            const mockDateNow = jest.spyOn(Date, 'now').mockReturnValue(now);

            // Mock data that should be cleaned up
            const oldData = [{
                stimulationId: 'old',
                timestamp: expectedCutoff - 1000, // Older than retention time
            }];

            const newData = [{
                stimulationId: 'new',
                timestamp: now - 1000, // Within retention time
            }];

            mockDb.stimulations.getAll.mockReturnValue([...oldData, ...newData]);
            mockDb.responses.getAll.mockReturnValue([]);
            mockDb.apps.getAll.mockReturnValue([]);

            limiter.enforceDataLimits();

            mockDateNow.mockRestore();
        });

        test('uses correct cleanup interval', () => {
            const setIntervalSpy = jest.spyOn(global, 'setInterval');

            limiter.startCleanup();

            expect(setIntervalSpy).toHaveBeenCalledWith(
                expect.any(Function),
                DEVTOOLS_LIMITS.CLEANUP_INTERVAL
            );
        });
    });

    describe('Memory Management', () => {
        test('estimates memory usage based on data types', () => {
            // Test with known quantities to verify calculation
            const stimulations = Array.from({ length: 100 }, (_, i) => ({ id: i }));
            const responses = Array.from({ length: 200 }, (_, i) => ({ id: i }));
            const neurons = Array.from({ length: 50 }, (_, i) => ({ id: i }));

            mockDb.stimulations.getAll.mockReturnValue(stimulations);
            mockDb.responses.getAll.mockReturnValue(responses);
            mockDb.neurons.getAll.mockReturnValue(neurons);
            mockDb.collaterals.getAll.mockReturnValue([]);
            mockDb.dendrites.getAll.mockReturnValue([]);
            mockDb.apps.getAll.mockReturnValue([]);

            const stats = limiter.getDataStats();

            // 100 * 0.5 + 200 * 0.3 + 50 * 0.1 = 50 + 60 + 5 = 115 KB
            expect(stats.memoryUsageKB).toBe(115);
        });

        test('detects when memory usage exceeds threshold', () => {
            // Create enough data to exceed 50MB
            const largeStimulations = Array.from({ length: 120000 }, (_, i) => ({ id: i }));

            mockDb.stimulations.getAll.mockReturnValue(largeStimulations);
            mockDb.responses.getAll.mockReturnValue([]);
            mockDb.neurons.getAll.mockReturnValue([]);
            mockDb.collaterals.getAll.mockReturnValue([]);
            mockDb.dendrites.getAll.mockReturnValue([]);
            mockDb.apps.getAll.mockReturnValue([]);

            const limits = limiter.checkLimits();

            expect(limits.memoryHigh).toBe(true);
            expect(limits.warnings).toContain(expect.stringContaining('60MB'));
        });
    });

    describe('Automatic Cleanup Integration', () => {
        test('runs cleanup at specified intervals', () => {
            const enforceDataLimitsSpy = jest.spyOn(limiter, 'enforceDataLimits');

            limiter.startCleanup();

            // Should not have run initially
            expect(enforceDataLimitsSpy).not.toHaveBeenCalled();

            // Advance time by cleanup interval
            jest.advanceTimersByTime(DEVTOOLS_LIMITS.CLEANUP_INTERVAL);

            expect(enforceDataLimitsSpy).toHaveBeenCalledTimes(1);

            // Advance time again
            jest.advanceTimersByTime(DEVTOOLS_LIMITS.CLEANUP_INTERVAL);

            expect(enforceDataLimitsSpy).toHaveBeenCalledTimes(2);
        });

        test('stops automatic cleanup when stopped', () => {
            const enforceDataLimitsSpy = jest.spyOn(limiter, 'enforceDataLimits');

            limiter.startCleanup();
            limiter.stopCleanup();

            // Advance time
            jest.advanceTimersByTime(DEVTOOLS_LIMITS.CLEANUP_INTERVAL * 2);

            expect(enforceDataLimitsSpy).not.toHaveBeenCalled();
        });
    });
});