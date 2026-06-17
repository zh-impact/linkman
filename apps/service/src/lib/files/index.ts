import fs from 'node:fs'
import path from 'node:path'

const DATABASE_PATH = process.env.DB_FILE_NAME || path.join(process.cwd(), 'data', 'linkman.db')
const filePath = DATABASE_PATH.startsWith('file:') ? DATABASE_PATH.slice(5) : DATABASE_PATH
const dataDir = path.resolve(path.dirname(filePath))

export const FILES_DIR = path.join(dataDir, 'files')

if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true })
}

export interface FileInfo {
  filename: string
  size: number
  modifiedAt: string
}

export function resolveFilePath(relativePath: string): string {
  const normalized = path.normalize(relativePath)
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error(`Invalid file path: ${relativePath}`)
  }
  const resolved = path.resolve(FILES_DIR, normalized)
  if (!resolved.startsWith(FILES_DIR + path.sep) && resolved !== FILES_DIR) {
    throw new Error(`Invalid file path: ${relativePath}`)
  }
  return resolved
}

export async function writeFile(relativePath: string, content: string): Promise<void> {
  const absPath = resolveFilePath(relativePath)
  const dir = path.dirname(absPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  await fs.promises.writeFile(absPath, content, 'utf-8')
}

export async function readFile(relativePath: string): Promise<string> {
  const absPath = resolveFilePath(relativePath)
  return fs.promises.readFile(absPath, 'utf-8')
}

export async function readFileLines(
  relativePath: string,
  startLine: number,
  count: number,
): Promise<{ lines: string[]; totalLines: number }> {
  const content = await readFile(relativePath)
  const allLines = content.split('\n')
  return {
    lines: allLines.slice(startLine, startLine + count),
    totalLines: allLines.length,
  }
}

export async function deleteFile(relativePath: string): Promise<void> {
  const absPath = resolveFilePath(relativePath)
  await fs.promises.unlink(absPath)
}

export async function listFiles(): Promise<FileInfo[]> {
  const results: FileInfo[] = []

  async function walk(dir: string, prefix: string) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(fullPath, relPath)
      } else {
        const stat = await fs.promises.stat(fullPath)
        results.push({
          filename: relPath,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        })
      }
    }
  }

  await walk(FILES_DIR, '')
  results.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  return results
}

/**
 * Flat list of { filename, size } for every file under FILES_DIR.
 * Used by the Files prune dryRun to compute totals + sample.
 */
export async function listAllFilesWithSize(): Promise<{ filename: string; size: number }[]> {
  const files = await listFiles()
  return files.map((f) => ({ filename: f.filename, size: f.size }))
}

/**
 * Delete every file under FILES_DIR. Returns the count actually removed and a
 * per-file error list (filesystem is not transactional — best-effort delete
 * continues on partial failures). Uses `rm({ force: true })` so files that
 * disappeared between listing and unlinking do not throw.
 */
export async function deleteAllFiles(): Promise<{ filesDeleted: number; errors: string[] }> {
  const files = await listAllFilesWithSize()
  const errors: string[] = []
  let filesDeleted = 0
  for (const file of files) {
    try {
      const abs = resolveFilePath(file.filename)
      await fs.promises.rm(abs, { force: true })
      filesDeleted++
    } catch (err) {
      errors.push(`${file.filename}: ${(err as Error).message}`)
    }
  }
  return { filesDeleted, errors }
}
