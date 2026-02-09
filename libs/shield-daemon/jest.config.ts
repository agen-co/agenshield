export default {
  displayName: 'shield-daemon',
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
  },
  testMatch: ['<rootDir>/src/__tests__/**/*.spec.ts'],
};
