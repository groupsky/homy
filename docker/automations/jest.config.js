/** @type {import('jest').Config} */
const config = {
    verbose: true,
    clearMocks: true,
    resetMocks: true,
    resetModules: true,
    restoreMocks: true,
    injectGlobals: false,
    notify: true,
    prettierPath: require.resolve('prettier-2'),
    slowTestThreshold: 1,
    testEnvironment: 'node',
    testMatch: [
         "**/__tests__/**/*.[jt]s?(x)",
        "**/*.(spec|test).[jt]s?(x)"
    ],
    globalSetup: './jest.global-setup.js',
};

module.exports = config;

