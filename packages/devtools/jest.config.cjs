module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/tests'],
    testMatch: ['**/?(*.)+(spec|test).ts'],
    transform: { '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', tsconfigFile: '<rootDir>/tsconfig.json' }] },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
    collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
    verbose: true,
};

