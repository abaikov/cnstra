export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
  },
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  moduleDirectories: ['node_modules'],
  roots: ['<rootDir>/tests']
};

