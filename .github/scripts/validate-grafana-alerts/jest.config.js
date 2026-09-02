export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      // tsconfig.json pins rootDir to src/ for the build. Tests live outside
      // it and may import a helper of their own (tests/lib/grafana-value-format.ts),
      // which tsc rejects under that rootDir. Widen it for compilation only.
      tsconfig: { rootDir: '.' },
    }],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    // Thin CLI shell: resolves the one fixed directory, prints and exits.
    // All of its decision logic lives in src/lib/report.ts, which is covered.
    '!src/index.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
