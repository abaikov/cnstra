export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@cnstra/postgres-schema$': '<rootDir>/../postgres-schema/src/index.ts',
  },
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'html', 'lcov', 'json-summary'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
  ],
  testMatch: [
    '<rootDir>/tests/**/*.test.{ts,tsx}'
  ]
};