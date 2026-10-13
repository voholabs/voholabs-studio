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
    // file-type and its tokenizer dependencies ship as ES modules only;
    // they are compiled to CommonJS so jest's runtime can load them.
    '^.+/node_modules/(file-type|strtok3|token-types|peek-readable|uint8array-extras|@tokenizer|@borewit|@noble|@scure|nostr-tools)/.+\\.js$':
      [
        'ts-jest',
        {
          tsconfig: {
            allowJs: true,
            isolatedModules: true,
            module: 'commonjs',
            target: 'es2020',
          },
        },
      ],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(file-type|strtok3|token-types|peek-readable|uint8array-extras|@tokenizer|@borewit|@noble|@scure|nostr-tools)/)',
  ],
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
