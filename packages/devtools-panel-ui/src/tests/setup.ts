// Test setup for DevTools Panel UI
import '@testing-library/jest-dom';

// Mock WebSocket for tests
global.WebSocket = jest.fn().mockImplementation(() => ({
    addEventListener: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
    readyState: 1, // OPEN
})) as any;

// Mock window properties
Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: jest.fn().mockImplementation(() => ({
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
    })),
});

// Console log filtering for cleaner test output
const originalLog = console.log;
console.log = (...args: any[]) => {
    // Only show test-related logs
    if (
        args.some(
            arg =>
                typeof arg === 'string' &&
                (arg.includes('🧠') ||
                    arg.includes('📊') ||
                    arg.includes('✅') ||
                    arg.includes('❌') ||
                    arg.includes('🔍') ||
                    arg.includes('Test'))
        )
    ) {
        originalLog(...args);
    }
};

// Setup global test utilities
(global as any).testUtils = {
    createMockNeuron: (id: string, name: string, appId: string) => ({
        id: `${appId}_${id}`,
        appId,
        name,
    }),

    createMockResponse: (
        id: string,
        appId: string,
        collateralName: string
    ) => ({
        id,
        appId,
        stimulationId: `stim_${id}`,
        timestamp: Date.now(),
        outputCollateralName: collateralName,
        queueLength: 0,
    }),

    waitForAsync: (ms: number = 100) =>
        new Promise(resolve => setTimeout(resolve, ms)),
};
