export default {
  displayName: 'shield-ipc',
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
    '^@agenshield/ipc$': '<rootDir>/src/index.ts',
    '^(.*)\\.js$': '$1',
  },
  coverageDirectory: '../../test-output/coverage/libs/shield-ipc',
  coverageReporters: ['text', 'lcov', 'json-summary'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist'],
};
