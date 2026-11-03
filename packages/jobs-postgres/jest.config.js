module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/?(*.)+(spec|test).ts'],
    moduleNameMapper: {
        '^@cnstra/postgres-schema$': '<rootDir>/../postgres-schema/src/index.ts',
        '^@cnstra/jobs$': '<rootDir>/../jobs/src/index.ts',
        '^@cnstra/jobs/testing$': '<rootDir>/../jobs/src/testing/index.ts',
    },
};
