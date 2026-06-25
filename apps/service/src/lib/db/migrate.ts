import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'

const DATABASE_PATH = process.env.DB_FILE_NAME || path.join(process.cwd(), 'data', 'linkman.db')
const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle')

const filePath = DATABASE_PATH.startsWith('file:') ? DATABASE_PATH.slice(5) : DATABASE_PATH
const dataDir = path.dirname(filePath)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

if (!fs.existsSync(MIGRATIONS_FOLDER)) {
  console.error(`Migrations folder not found: ${MIGRATIONS_FOLDER}`)
  console.error('Run "npm run db:generate" first to create migration files.')
  process.exit(1)
}

const client = createClient({ url: DATABASE_PATH })
const db = drizzle({ client })

console.log(`Initializing database at: ${DATABASE_PATH}`)
console.log(`Using migrations from: ${MIGRATIONS_FOLDER}`)

migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  .then(() => {
    console.log('Database migration completed successfully.')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Database migration failed:', err)
    process.exit(1)
  })
