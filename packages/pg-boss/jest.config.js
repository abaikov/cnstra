module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/?(*.)+(spec|test).ts'],
    moduleNameMapper: {
        '^@cnstra/types$': '<rootDir>/../types/src/index.ts',
        '^@cnstra/core$': '<rootDir>/../core/src/index.ts',
        '^@cnstra/persist$': '<rootDir>/../persist/src/index.ts',
    },
};
