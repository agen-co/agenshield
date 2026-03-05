export default {
  displayName: 'storage',
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
  },
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  coverageDirectory: '../../test-output/coverage/libs/storage',
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/src/migrations/',
  ],
};
