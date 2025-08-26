export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: [
    '**/__tests__/**/*.test.js', 
    '**/src/**/*.test.js', 
    '**/?(*.)+(spec|test).js'
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    'index.js',
    '!jest.config.js',
    '!test-setup.js',
    '!**/node_modules/**',
    '!**/__tests__/**',
    '!**/*.test.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  transformIgnorePatterns: [
    'node_modules/(?!(msw|testcontainers)/)'
  ],
  clearMocks: true,
  resetMocks: false,
  resetModules: false,
  // Add timeout for Testcontainers
  testTimeout: 120000
};