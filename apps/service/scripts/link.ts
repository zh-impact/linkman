import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname } from 'node:path'

import { program } from 'commander'

import {
  detectFormat,
  extractUrlOnly,
  extractUrlTitlePipe,
  type Link,
  parseLinks,
  parseTitleUrlDash,
  splitLines,
} from '../src/lib/url/extract'

const lineParsers: Record<string, (line: string) => Link | null> = {
  url_only: extractUrlOnly,
  pipe: extractUrlTitlePipe,
  dash: parseTitleUrlDash,
}

function dedup(links: Link[]): Link[] {
  const seen = new Set<string>()
  return links.filter((link) => {
    if (seen.has(link.url)) return false
    seen.add(link.url)
    return true
  })
}

interface FileResult {
  filename: string
  format: string
  lines: number
  links: Link[]
  emptyLines: number[]
  skipped: { line: number; content: string }[]
}

async function processFile(filepath: string): Promise<FileResult> {
  const content = await readFile(filepath, 'utf8')
  const extension = extname(filepath).toLowerCase()
  const format = detectFormat(content, extension)
  const lines = splitLines(content)

  const emptyLines: number[] = []
  const skipped: { line: number; content: string }[] = []
  const links: Link[] = []

  const parser = lineParsers[format]
  if (parser) {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (!trimmed) {
        emptyLines.push(i + 1)
        continue
      }
      const link = parser(lines[i])
      if (link) {
        links.push(link)
      } else {
        skipped.push({ line: i + 1, content: trimmed })
      }
    }
  } else {
    links.push(...parseLinks(content, extension))
  }

  return { filename: filepath, format, lines: lines.length, links, emptyLines, skipped }
}

function printFileResult(r: FileResult): void {
  console.log(`  Format: ${r.format}`)
  console.log(`  Lines: ${r.lines}`)
  console.log(`  Links: ${r.links.length}`)
  if (r.emptyLines.length) {
    console.log(`  Empty: ${r.emptyLines.length} (line ${r.emptyLines.join(', ')})`)
  }
  if (r.skipped.length) {
    console.log(`  Skipped: ${r.skipped.length}`)
    for (const s of r.skipped) {
      console.log(`    line ${s.line}: ${s.content}`)
    }
  }
}

program
  .command('extract')
  .argument('<path>', 'Path to a file or directory')
  .option('-o, --output <path>', 'Save results to a JSON file')
  .action(async (inputPath: string, options: { output?: string }) => {
    const { readdir, stat } = await import('node:fs/promises')
    const { resolve } = await import('node:path')

    const inputStat = await stat(inputPath)

    if (!inputStat.isDirectory()) {
      // Single file mode
      const result = await processFile(resolve(inputPath))
      const unique = dedup(result.links)

      console.log(`File: ${result.filename}`)
      printFileResult(result)
      console.log(`Unique: ${unique.length}`)

      if (options.output) {
        await mkdir(dirname(options.output), { recursive: true })
        await writeFile(options.output, `${JSON.stringify(unique, null, 2)}\n`)
        console.log(`\nSaved to: ${options.output}`)
      }
      return
    }

    // Directory mode
    const entries = await readdir(inputPath)
    const files = entries.filter((name) => !name.startsWith('.')).sort()

    console.log(`Scanning: ${resolve(inputPath)}`)
    console.log('─'.repeat(50))

    const seen = new Set<string>()
    const allLinks: Link[] = []
    let totalLines = 0
    let totalLinks = 0

    for (const name of files) {
      const filepath = resolve(inputPath, name)
      const fileStat = await stat(filepath)
      if (!fileStat.isFile()) continue

      console.log(`\n${name}`)
      const result = await processFile(filepath)
      printFileResult(result)

      totalLines += result.lines
      totalLinks += result.links.length

      // Global dedup
      for (const link of result.links) {
        if (!seen.has(link.url)) {
          seen.add(link.url)
          allLinks.push(link)
        }
      }
    }

    console.log('\n')
    console.log('─'.repeat(50))
    console.log(`Files: ${files.length}`)
    console.log(`Lines: ${totalLines}`)
    console.log(`Links: ${totalLinks}, Unique: ${allLinks.length}`)

    if (options.output) {
      await mkdir(dirname(options.output), { recursive: true })
      await writeFile(options.output, `${JSON.stringify(allLinks, null, 2)}\n`)
      console.log(`\nSaved to: ${options.output}`)
    }
  })

program.parseAsync()
