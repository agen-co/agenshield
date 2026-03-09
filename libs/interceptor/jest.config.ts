export default {
  displayName: 'interceptor',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript' },
          target: 'es2022',
        },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  moduleNameMapper: {
    '^(.*)\\.js$': '$1',
    '^@agenshield/seatbelt$': '<rootDir>/../seatbelt/src/index.ts',
    '^@agenshield/ipc$': '<rootDir>/../shield-ipc/src/index.ts',
    '^@agenshield/policies$': '<rootDir>/../policies/src/index.ts',
    '^@agenshield/storage$': '<rootDir>/../storage/src/index.ts',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/register.ts',
    '!src/require.ts',
    '!src/resource/index.ts',
    '!src/python/index.ts',
    '!src/python/types.ts',
  ],
  coverageDirectory: '../../test-output/coverage/libs/interceptor',
  coverageReporters: ['text', 'lcov', 'json-summary'],
  testMatch: ['<rootDir>/src/__tests__/**/*.spec.ts'],
};
