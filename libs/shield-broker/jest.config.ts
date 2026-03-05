export default {
  displayName: 'shield-broker',
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
    '^@agenshield/ipc$': '<rootDir>/../shield-ipc/src/index.ts',
    '^@agenshield/policies$': '<rootDir>/../policies/src/index.ts',
    '^@agenshield/proxy$': '<rootDir>/../proxy/src/index.ts',
    '^(.*)\\.js$': '$1',
  },
  coverageDirectory: '../../test-output/coverage/libs/shield-broker',
  testMatch: ['<rootDir>/src/__tests__/**/*.spec.ts'],
};
