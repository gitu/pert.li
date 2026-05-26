import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: ['.env.local', '.env'] })

// drizzle-kit invokes us when the user runs `db:push`, `db:generate`, or
// `db:migrate`. All of those need a real connection string — fail loudly here
// rather than passing `undefined` through and getting a cryptic error inside
// drizzle-kit's networking layer.
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for drizzle-kit commands (db:push / db:generate / db:migrate). Set it in .env.local.',
  )
}

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
})
