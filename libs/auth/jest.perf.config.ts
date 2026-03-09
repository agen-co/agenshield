export default {
  displayName: 'auth-perf',
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
    // Transform jose ESM to CJS for Jest
    'node_modules/jose/.+\\.js$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'ecmascript' },
          target: 'es2022',
        },
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!jose)'],
  testMatch: ['<rootDir>/src/**/*.perf.ts'],
};
