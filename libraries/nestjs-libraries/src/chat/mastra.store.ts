import { PostgresStore } from '@mastra/pg';

// Mastra creates and migrates its own tables. They live in their own
// Postgres schema so the boot-time `prisma db push`, which only manages
// `public`, never drops or rewrites them.
export const pStore = new PostgresStore({
  id: 'postiz-store',
  connectionString: process.env.DATABASE_URL!,
  schemaName: 'mastra',
});
