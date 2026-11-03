module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/?(*.)+(spec|test).ts'],
    moduleNameMapper: { '^@cnstra/sync$': '<rootDir>/../sync/src/index.ts' },
};
