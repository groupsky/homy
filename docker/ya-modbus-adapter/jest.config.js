/** @type {import('jest').Config} */
const config = {
    clearMocks: true,
    errorOnDeprecated: true,
    injectGlobals: false,
    randomize: true,
    resetMocks: true,
    resetModules: true,
    restoreMocks: true,
    testEnvironment: 'node',
};

module.exports = config;
