import { z } from 'zod'

export const urlSchema = z.string().refine(
  (str) => {
    try {
      new URL(str)
      return true
    } catch {
      return false
    }
  },
  { message: 'Invalid URL format' },
)

export const urlArraySchema = z.array(urlSchema)

export const validateUrl = (url: string): boolean => {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export const validateUrls = (urls: string[]): { valid: string[]; invalid: string[] } => {
  const valid: string[] = []
  const invalid: string[] = []

  for (const url of urls) {
    if (url.trim() === '') continue // Skip empty lines
    if (validateUrl(url)) {
      valid.push(url)
    } else {
      invalid.push(url)
    }
  }

  return { valid, invalid }
}
