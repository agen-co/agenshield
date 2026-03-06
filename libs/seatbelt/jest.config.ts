export default {
  displayName: 'seatbelt',
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
  moduleNameMapper: {
    '^(.*)\\.js$': '$1',
    '^@agenshield/ipc$': '<rootDir>/../shield-ipc/src/index.ts',
    '^@agenshield/policies$': '<rootDir>/../policies/src/index.ts',
    '^@agenshield/storage$': '<rootDir>/../storage/src/index.ts',
  },
  coverageDirectory: '../../test-output/coverage/libs/seatbelt',
  coverageReporters: ['text', 'lcov', 'json-summary'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};
