export default {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/tests'],
    testMatch: ['**/__tests__/**/*.ts', '**/*.test.ts'],
    transform: {
        '^.+\\.(t|j)sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
    },
    collectCoverageFrom: ['src/**/*.ts', '!src/**/__tests__/**', '!src/**/*.test.ts'],
    verbose: true,
    testTimeout: 10000, // 10 seconds timeout for all tests
};


