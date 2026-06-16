import { extractUrlTitlePipe, type Link, splitLines } from '../../url/extract'
import type { Extractor } from './types'

/** `URL | Title` pipe-delimited exports (e.g. some Markdown link dumps). */
export const pipeExtractor: Extractor = {
  format: 'pipe',
  detect: (ctx) => ctx.type === 'TXT' && ctx.firstLines.some((l) => l.includes(' | ')),
  extract: (content: string): Link[] =>
    splitLines(content)
      .map(extractUrlTitlePipe)
      .filter((link): link is Link => link !== null),
}
