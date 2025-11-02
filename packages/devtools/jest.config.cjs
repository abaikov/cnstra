module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
    transform: { 
        '^.+\\.(ts|tsx)$': ['ts-jest', { 
            tsconfig: '<rootDir>/tsconfig.json',
        }] 
    },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
    collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
    verbose: true,
};
