export default {
  displayName: 'skills',
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
    '^@agenshield/storage$': '<rootDir>/../storage/src/index.ts',
  },
  coverageDirectory: '../../test-output/coverage/libs/skills',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};
