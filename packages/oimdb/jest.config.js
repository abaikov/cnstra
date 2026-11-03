const shared = {
    preset: 'ts-jest',
    roots: ['<rootDir>/src'],
    moduleNameMapper: {
        '^@cnstra/sync$': '<rootDir>/../sync/src/index.ts',
        '^react(/.*)?$': '<rootDir>/../../node_modules/react$1',
        '^react-dom(.*)$': '<rootDir>/../../node_modules/react-dom$1',
    },
};

module.exports = {
    projects: [
        { ...shared, displayName: 'node', testEnvironment: 'node', testMatch: ['**/?(*.)+(spec|test).ts'] },
        { ...shared, displayName: 'react', testEnvironment: 'jsdom', testMatch: ['**/?(*.)+(spec|test).tsx'] },
    ],
};
