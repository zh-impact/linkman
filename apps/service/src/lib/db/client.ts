import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'

const DATABASE_PATH = process.env.DB_FILE_NAME || path.join(process.cwd(), 'data', 'linkman.db')

// Ensure data directory exists (strip file: prefix if present)
const filePath = DATABASE_PATH.startsWith('file:') ? DATABASE_PATH.slice(5) : DATABASE_PATH
const dataDir = path.dirname(filePath)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const client = createClient({ url: DATABASE_PATH })

export const db = drizzle({ client })
