module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/?(*.)+(spec|test).ts'],
    moduleNameMapper: {
        '^@cnstra/persist$': '<rootDir>/../persist/src/index.ts',
        '^@cnstra/persist-dto$': '<rootDir>/../persist-dto/src/index.ts',
    },
};
