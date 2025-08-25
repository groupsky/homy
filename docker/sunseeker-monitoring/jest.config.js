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
    'node_modules/(?!(msw)/)'
  ],
  clearMocks: true,
  resetMocks: false,
  resetModules: false
};