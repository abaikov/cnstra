module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/?(*.)+(spec|test).ts'],
    moduleNameMapper: {
        '^@cnstra/broker$': '<rootDir>/../broker/src/index.ts',
        '^@cnstra/core$': '<rootDir>/../core/src/index.ts',
        '^@cnstra/jobs$': '<rootDir>/../jobs/src/index.ts',
        '^@cnstra/jobs-postgres$': '<rootDir>/../jobs-postgres/src/index.ts',
        '^@cnstra/persist$': '<rootDir>/../persist/src/index.ts',
        '^@cnstra/persist-dto$': '<rootDir>/../persist-dto/src/index.ts',
        '^@cnstra/types$': '<rootDir>/../types/src/index.ts',
    },
};
