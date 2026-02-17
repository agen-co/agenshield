export default {
  displayName: 'shield-interceptor',
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
    '^@agenshield/seatbelt$': '<rootDir>/../seatbelt/src/index.ts',
    '^@agenshield/ipc$': '<rootDir>/../shield-ipc/src/index.ts',
    '^@agenshield/policies$': '<rootDir>/../policies/src/index.ts',
    '^@agenshield/storage$': '<rootDir>/../storage/src/index.ts',
  },
  testMatch: ['<rootDir>/src/__tests__/**/*.spec.ts'],
};
