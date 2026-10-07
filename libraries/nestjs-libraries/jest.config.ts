// Unit tests for libraries/nestjs-libraries. Run from the repo root:
//   npx jest -c libraries/nestjs-libraries/jest.config.ts
// Plain stubs only: no database, no network.
import { join } from 'path';

const root = join(__dirname, '..', '..');

export default {
  displayName: 'nestjs-libraries',
  rootDir: root,
  // apps/backend/src too: its auth specs need the same mappings.
  roots: [
    '<rootDir>/libraries/nestjs-libraries/src',
    '<rootDir>/apps/backend/src',
  ],
  testMatch: ['**/*.spec.ts'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          isolatedModules: true,
          module: 'commonjs',
          target: 'es2020',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          strict: false,
        },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^isomorphic-dompurify$':
      '<rootDir>/libraries/nestjs-libraries/jest.dompurify.shim.js',
    '^@gitroom/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
    '^@gitroom/nestjs-libraries/(.*)$':
      '<rootDir>/libraries/nestjs-libraries/src/$1',
    '^@gitroom/react/(.*)$':
      '<rootDir>/libraries/react-shared-libraries/src/$1',
    '^@gitroom/plugins/(.*)$': '<rootDir>/libraries/plugins/src/$1',
    '^@gitroom/backend/(.*)$': '<rootDir>/apps/backend/src/$1',
    '^@gitroom/orchestrator/(.*)$': '<rootDir>/apps/orchestrator/src/$1',
  },
};
