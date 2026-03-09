export default {
  displayName: 'interceptor-perf',
  preset: '../../jest.preset.js',
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
  moduleNameMapper: {
    '^@agenshield/seatbelt$': '<rootDir>/../seatbelt/src/index.ts',
    '^@agenshield/ipc$': '<rootDir>/../shield-ipc/src/index.ts',
    '^@agenshield/policies$': '<rootDir>/../policies/src/index.ts',
    '^@agenshield/storage$': '<rootDir>/../storage/src/index.ts',
  },
  testMatch: ['<rootDir>/src/**/*.perf.ts'],
};
