export default {
  displayName: 'proxy-perf',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript' },
          target: 'esnext',
        },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^(.*)\\.js$': '$1',
    '^@agenshield/ipc$': '<rootDir>/../shield-ipc/src/index.ts',
    '^@agenshield/policies$': '<rootDir>/../policies/src/index.ts',
  },
  coverageDirectory: '../../test-output/performance/libs/proxy',
  testMatch: ['<rootDir>/src/**/*.perf.ts'],
};
