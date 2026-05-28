import 'dotenv/config'
import assert from 'node:assert'
import { defineConfig } from 'drizzle-kit'

assert(process.env.DB_FILE_NAME, 'DB_FILE_NAME environment variable must be set')

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_FILE_NAME,
  },
})
