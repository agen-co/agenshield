export default {
  displayName: 'e2e',
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
  testMatch: ['<rootDir>/src/__tests__/**/*.spec.ts'],
  testTimeout: 120_000,
  globalSetup: '<rootDir>/src/setup/global-setup.ts',
  globalTeardown: '<rootDir>/src/setup/global-teardown.ts',
  testSequencer: '<rootDir>/src/setup/sequencer.ts',
};
