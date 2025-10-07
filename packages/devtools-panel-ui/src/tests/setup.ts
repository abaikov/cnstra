// Test setup for DevTools Panel UI

// Mock PixiJS to avoid WebGL issues in tests
jest.mock('pixi.js', () => ({
    Application: jest.fn().mockImplementation(() => ({
        init: jest.fn().mockResolvedValue(undefined),
        canvas: document.createElement('canvas'),
        stage: {
            addChild: jest.fn(),
        },
        renderer: {
            resize: jest.fn(),
        },
        destroy: jest.fn(),
    })),
    Graphics: jest.fn().mockImplementation(() => ({
        circle: jest.fn().mockReturnThis(),
        fill: jest.fn().mockReturnThis(),
        stroke: jest.fn().mockReturnThis(),
        moveTo: jest.fn().mockReturnThis(),
        lineTo: jest.fn().mockReturnThis(),
        clear: jest.fn().mockReturnThis(),
        on: jest.fn(),
        tint: 0xffffff,
        eventMode: 'static',
        cursor: 'pointer',
        x: 0,
        y: 0,
    })),
    Container: jest.fn().mockImplementation(() => ({
        addChild: jest.fn(),
        x: 0,
        y: 0,
    })),
    Text: jest.fn().mockImplementation(() => ({
        x: 0,
        y: 0,
    })),
}));

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
