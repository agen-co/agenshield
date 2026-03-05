export default {
  displayName: 'cli',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transform: {
    '^.+\\.[tj]s$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript' },
          target: 'es2022',
        },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../test-output/coverage/libs/cli',
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/src/index.ts', // Ignore index.ts (re-exports only, no logic to test)
  ],
  testMatch: ['**/__tests__/**/*.spec.ts'],
  testTimeout: 60000,
  passWithNoTests: true,
};
