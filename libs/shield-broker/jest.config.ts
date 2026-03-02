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
    '^(.*)\\.js$': '$1',
  },
  testMatch: ['<rootDir>/src/__tests__/**/*.spec.ts'],
};
