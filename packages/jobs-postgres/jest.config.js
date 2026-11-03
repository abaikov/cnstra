module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    transform: {
        '^.+\\.ts$': 'ts-jest',
        '^.+/node_modules/uuid/.+\\.js$': ['babel-jest', { plugins: ['@babel/plugin-transform-modules-commonjs'] }],
    },
    transformIgnorePatterns: ['/node_modules/(?!uuid/)'],
    testMatch: ['**/?(*.)+(spec|test).ts'],
    moduleNameMapper: {
        '^@cnstra/postgres-schema$': '<rootDir>/../postgres-schema/src/index.ts',
        '^@cnstra/jobs$': '<rootDir>/../jobs/src/index.ts',
        '^@cnstra/jobs/testing$': '<rootDir>/../jobs/src/testing/index.ts',
    },
};
