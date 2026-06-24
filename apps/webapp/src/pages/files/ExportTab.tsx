import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Switch,
  Text,
} from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { trpc } from '../../utils/trpc-client'

interface FileInfo {
  filename: string
  size: number
  modifiedAt: string
}

interface PreviewSampleRow {
  url: string
  title: string
}

interface PreviewResultOk {
  kind: 'ok'
  filename: string
  detectedFormat: string
  linkCount: number
  /** First N non-empty lines of the source file, verbatim — lets the user
   *  eyeball the original format (OneTab's `URL * Title`, CSV rows, HTML
   *  anchors, etc.) alongside the extracted sample. */
  rawSample: string[]
  sample: PreviewSampleRow[]
}

interface PreviewResultErr {
  kind: 'err'
  filename: string
  error: string
}

type PreviewResult = PreviewResultOk | PreviewResultErr

interface BatchResultRow {
  filename: string
  ok: boolean
  error?: string
  savedPath?: string
  skipped?: boolean
  linkCount?: number
}

interface BatchSummary {
  total: number
  succeeded: number
  skipped: number
  rows: BatchResultRow[]
}

/**
 * Trigger a browser download of a JSON string as `<filename>`. Uses Blob +
 * URL.createObjectURL + a temporary `<a download>` element + revokeObjectURL
 * so the blob is freed once the download starts.
 *
 * Exported separately from the inline export loop so it can be tested in
 * isolation if we ever add unit tests for the UI.
 */
export function downloadJsonFile(filename: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } finally {
    // Defer revoke a tick so the browser has a chance to read the URL.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

/**
 * Build a fallback filename for browser download when the server didn't
 * save (i.e. `saveToExports` off). The server controls the canonical
 * `<stem>-<hash8>.json` name when it writes; when only downloading, we use
 * a timestamped name locally because the client can't cheaply reproduce
 * the sha256 of a multi-MB file in the browser (we'd need to fetch the
 * raw bytes, hash them, then re-fetch for download).
 *
 * This asymmetry is acceptable: the filename is for the user's local
 * filesystem only; the server-saved name (when enabled) is the
 * content-addressed source of truth.
 */
function buildDownloadFilename(sourceFilename: string): string {
  const lastSlash = Math.max(sourceFilename.lastIndexOf('/'), sourceFilename.lastIndexOf('\\'))
  const base = sourceFilename.slice(lastSlash + 1)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const safeStem = stem.replace(/[/\\]/g, '-')
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `${safeStem}-${ts}.json`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ExportTab() {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [fileError, setFileError] = useState('')

  // Per-file detected format, populated by `export.classify` on mount. Used
  // to hide files whose source is already standard JSON (`json_array`) so the
  // list focuses on files that actually need conversion. `undefined` = not
  // yet classified (still loading or classify failed).
  const [formatMap, setFormatMap] = useState<Map<string, string>>(new Map())
  const [classifying, setClassifying] = useState(false)
  const [classifyError, setClassifyError] = useState('')
  // Default ON: hide files that are already `[{url,title}, ...]` arrays.
  // The user can flip this off to see / export them anyway.
  const [hideStandardJson, setHideStandardJson] = useState(true)

  const [previews, setPreviews] = useState<PreviewResult[] | undefined>()
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState('')

  // Two independent delivery toggles. Defaults both ON so the common case
  // ("download + back up to server") is one click. Export button is disabled
  // when both are off — there'd be nothing to do.
  const [download, setDownload] = useState(true)
  const [saveToExports, setSaveToExports] = useState(true)
  const [batch, setBatch] = useState<{ done: number; total: number; current: string } | null>(null)
  const [summary, setSummary] = useState<BatchSummary | undefined>()
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const anyDelivery = download || saveToExports

  const fetchFiles = useCallback(async () => {
    setLoadingFiles(true)
    setFileError('')
    try {
      const fs = await trpc.files.list.query()
      setFiles(fs as FileInfo[])
      // Kick off classification in the background. Non-blocking so the list
      // renders first; format-aware filtering kicks in once results arrive.
      setClassifying(true)
      setClassifyError('')
      try {
        const filenames = (fs as FileInfo[]).map((f) => f.filename)
        const r = await trpc.export.classify.mutate({ filenames })
        const m = new Map<string, string>()
        for (const item of r) {
          if ('detectedFormat' in item) m.set(item.filename, item.detectedFormat)
        }
        setFormatMap(m)
      } catch (err) {
        setClassifyError(err instanceof Error ? err.message : 'Failed to classify files')
      } finally {
        setClassifying(false)
      }
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Failed to load files')
    } finally {
      setLoadingFiles(false)
    }
  }, [])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  // Apply the "hide already-standard JSON" filter at render time. We keep
  // `files` as the full inventory (so Select-all still knows the universe)
  // and derive the visible list here. Selection state is keyed by filename
  // regardless of visibility, so toggling the filter never loses checks.
  const visibleFiles = hideStandardJson
    ? files.filter((f) => formatMap.get(f.filename) !== 'json_array')
    : files
  const hiddenCount = files.length - visibleFiles.length

  const toggleFile = useCallback((filename: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(filename)) next.delete(filename)
      else next.add(filename)
      return next
    })
  }, [])

  // Select-all operates over the *visible* list, not the full inventory —
  // otherwise hiding json_array files would make "Select all" silently pick
  // the hidden ones too.
  const allSelected = visibleFiles.length > 0 && selected.size === visibleFiles.length
  const someSelected = selected.size > 0 && !allSelected

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const visibleFilenames = (
        hideStandardJson ? files.filter((f) => formatMap.get(f.filename) !== 'json_array') : files
      ).map((f) => f.filename)
      const allVisibleSelected =
        visibleFilenames.length > 0 && visibleFilenames.every((fn) => prev.has(fn))
      if (allVisibleSelected) {
        const next = new Set(prev)
        for (const fn of visibleFilenames) next.delete(fn)
        return next
      }
      return new Set([...prev, ...visibleFilenames])
    })
  }, [files, hideStandardJson, formatMap])

  const handlePreview = useCallback(async () => {
    if (selected.size === 0) return
    setPreviewing(true)
    setPreviewError('')
    setPreviews(undefined)
    setSummary(undefined)
    try {
      const r = await trpc.export.preview.mutate({ filenames: [...selected] })
      setPreviews(
        r.map((item) => {
          if ('error' in item && typeof item.error === 'string') {
            return { kind: 'err', filename: item.filename, error: item.error }
          }
          return {
            kind: 'ok',
            filename: item.filename,
            detectedFormat: item.detectedFormat,
            linkCount: item.linkCount,
            rawSample: (item as { rawSample?: string[] }).rawSample ?? [],
            sample: item.sample,
          }
        }),
      )
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }, [selected])

  const handleExport = useCallback(async () => {
    if (selected.size === 0) return
    setExporting(true)
    setExportError('')
    setSummary(undefined)
    setPreviews(undefined)
    const filenames = [...selected]
    setBatch({ done: 0, total: filenames.length, current: filenames[0] ?? '' })
    const rows: BatchResultRow[] = []
    try {
      for (let i = 0; i < filenames.length; i++) {
        const filename = filenames[i]
        setBatch({ done: i, total: filenames.length, current: filename })
        try {
          const r = await trpc.export.run.mutate({ filename, download, saveToExports })
          // Server always returns the JSON; only Blob-download when the user
          // opted in. The server doesn't know whether the browser actually
          // received the bytes — that's a client-side concern.
          if (download) {
            // Prefer the content-addressed name when the server saved one
            // (canonical, dedup-friendly). Fall back to a local timestamp
            // name when only downloading.
            const downloadName = r.savedPath ?? buildDownloadFilename(filename)
            downloadJsonFile(downloadName, r.json)
          }
          rows.push({
            filename,
            ok: true,
            savedPath: r.savedPath,
            skipped: r.skipped,
            linkCount: r.linkCount,
          })
        } catch (err) {
          rows.push({
            filename,
            ok: false,
            error: err instanceof Error ? err.message : 'export failed',
          })
        }
      }
      setBatch({ done: filenames.length, total: filenames.length, current: '' })
      setSummary({
        total: filenames.length,
        succeeded: rows.filter((r) => r.ok).length,
        skipped: rows.filter((r) => r.ok && r.skipped).length,
        rows,
      })
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
      setBatch(null)
    }
  }, [selected, download, saveToExports])

  return (
    <Stack gap="md">
      <Card withBorder p="md">
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm">
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                onChange={toggleAll}
                disabled={loadingFiles || visibleFiles.length === 0}
                label={allSelected ? 'Clear visible' : 'Select visible'}
              />
              <Text size="sm" c="dimmed">
                {selected.size} selected · {visibleFiles.length} shown
                {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
                {classifying && ' · classifying…'}
              </Text>
              <Switch
                size="xs"
                label="Hide already-standard JSON"
                checked={hideStandardJson}
                onChange={(e) => setHideStandardJson(e.currentTarget.checked)}
                disabled={exporting || classifying}
              />
            </Group>
            <Group gap="xs" wrap="nowrap">
              <Switch
                size="xs"
                label="Browser download"
                checked={download}
                onChange={(e) => setDownload(e.currentTarget.checked)}
                disabled={exporting}
              />
              <Switch
                size="xs"
                label="Save to data/exports/"
                checked={saveToExports}
                onChange={(e) => setSaveToExports(e.currentTarget.checked)}
                disabled={exporting}
              />
              <Button
                size="xs"
                variant="default"
                onClick={handlePreview}
                disabled={selected.size === 0 || previewing || exporting}
                loading={previewing}
              >
                Preview
              </Button>
              <Button
                size="xs"
                color="blue"
                onClick={handleExport}
                disabled={selected.size === 0 || previewing || exporting || !anyDelivery}
                loading={exporting}
              >
                Export
              </Button>
            </Group>
          </Group>

          {batch && (
            <Group gap="sm" align="center">
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {batch.done}/{batch.total}
                {batch.current && ` · ${batch.current}`}
              </Text>
              {exporting && <Loader size="xs" />}
            </Group>
          )}

          {fileError && (
            <Alert color="red" variant="light">
              {fileError}
            </Alert>
          )}
          {classifyError && (
            <Alert color="yellow" variant="light">
              Classification failed — list will show all files including standard JSON.{' '}
              {classifyError}
            </Alert>
          )}
          {previewError && (
            <Alert color="red" variant="light">
              {previewError}
            </Alert>
          )}
          {exportError && (
            <Alert color="red" variant="light">
              {exportError}
            </Alert>
          )}

          {loadingFiles ? (
            <Loader />
          ) : visibleFiles.length === 0 ? (
            <Text c="dimmed" ta="center" py="md">
              {files.length === 0
                ? 'No files yet. Import a file in the Sources tab first.'
                : 'All files are already standard JSON. Toggle "Hide already-standard JSON" off to see them.'}
            </Text>
          ) : (
            <ScrollArea.Autosize mah="40vh" type="auto" offsetScrollbars>
              <Stack gap={2}>
                {visibleFiles.map((f) => {
                  const checked = selected.has(f.filename)
                  const previewRow = previews?.find((p) => p.filename === f.filename)
                  const linkCount = previewRow?.kind === 'ok' ? previewRow.linkCount : undefined
                  // detectedFormat from classify (always present once classify
                  // finishes) wins; preview's value is the same data but only
                  // available after the user clicks Preview.
                  const detectedFormat =
                    previewRow?.kind === 'ok'
                      ? previewRow.detectedFormat
                      : formatMap.get(f.filename)
                  return (
                    <Box
                      key={f.filename}
                      px="xs"
                      py={6}
                      style={{
                        borderBottom: '1px solid var(--mantine-color-gray-2)',
                      }}
                    >
                      <Group gap="xs" wrap="nowrap">
                        <Checkbox
                          checked={checked}
                          onChange={() => toggleFile(f.filename)}
                          disabled={exporting}
                        />
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text size="sm" fw={500} truncate>
                            {f.filename}
                          </Text>
                          <Group gap="xs">
                            <Text size="xs" c="dimmed">
                              {formatSize(f.size)}
                            </Text>
                            {linkCount !== undefined && (
                              <Text size="xs" c="dimmed">
                                · {linkCount.toLocaleString()} links
                              </Text>
                            )}
                          </Group>
                        </Box>
                        {detectedFormat && (
                          <Badge
                            size="xs"
                            variant="light"
                            color={detectedFormat === 'json_array' ? 'green' : 'blue'}
                            title={
                              detectedFormat === 'json_array'
                                ? 'Source is already a standard JSON array — export is essentially a copy'
                                : `Source format: ${detectedFormat}`
                            }
                          >
                            {detectedFormat}
                          </Badge>
                        )}
                      </Group>
                      {previewRow?.kind === 'err' && (
                        <Text size="xs" c="red" px="md">
                          {previewRow.error}
                        </Text>
                      )}
                    </Box>
                  )
                })}
              </Stack>
            </ScrollArea.Autosize>
          )}
        </Stack>
      </Card>

      {previews && previews.length > 0 && (
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Preview
          </Text>
          {previews.map((p) => {
            // Same color coding as the list row: green = source is already
            // a standard JSON array (no real conversion happens on export);
            // blue = source needs structural conversion. We also add an
            // explicit textual hint so the user can tell at a glance
            // whether exporting this file is meaningful.
            const isStandard = p.kind === 'ok' && p.detectedFormat === 'json_array'
            return (
              <Card key={p.filename} withBorder p="sm">
                {p.kind === 'ok' ? (
                  <Stack gap={4}>
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm" fw={500} truncate style={{ flex: 1, minWidth: 0 }}>
                        {p.filename}
                      </Text>
                      <Badge
                        size="xs"
                        variant="light"
                        color={isStandard ? 'green' : 'blue'}
                        title={
                          isStandard
                            ? 'Source is already a standard JSON array — export is essentially a copy'
                            : `Source format: ${p.detectedFormat} — export will convert to standard JSON`
                        }
                      >
                        {p.detectedFormat}
                      </Badge>
                      {isStandard && (
                        <Badge size="xs" variant="filled" color="green">
                          already standard
                        </Badge>
                      )}
                      <Badge size="xs" variant="filled" color={p.linkCount > 0 ? 'blue' : 'gray'}>
                        {p.linkCount.toLocaleString()} links
                      </Badge>
                    </Group>
                    {p.rawSample.length > 0 && (
                      <Stack gap={2}>
                        <Text size="xs" c="dimmed" fw={500}>
                          Source (raw):
                        </Text>
                        <ScrollArea.Autosize mah={160} type="auto" offsetScrollbars>
                          <Box
                            component="pre"
                            p="xs"
                            style={{
                              margin: 0,
                              background: 'var(--mantine-color-gray-0)',
                              borderRadius: 4,
                              fontFamily: 'var(--mantine-font-family-monospace)',
                              fontSize: 11,
                              lineHeight: 1.4,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-all',
                            }}
                          >
                            {p.rawSample.join('\n')}
                          </Box>
                        </ScrollArea.Autosize>
                      </Stack>
                    )}
                    <Stack gap={2}>
                      <Text size="xs" c="dimmed" fw={500}>
                        Extracted ({p.linkCount.toLocaleString()} links):
                      </Text>
                      {p.sample.length > 0 ? (
                        <ScrollArea.Autosize mah={120} type="auto" offsetScrollbars>
                          <Stack gap={2}>
                            {p.sample.map((row) => (
                              <Text
                                key={`${row.url}|${row.title}`}
                                size="xs"
                                ff="monospace"
                                truncate
                              >
                                {row.url}
                                {row.title ? ` — ${row.title}` : ''}
                              </Text>
                            ))}
                          </Stack>
                        </ScrollArea.Autosize>
                      ) : (
                        <Text size="xs" c="dimmed">
                          No links detected — export will produce an empty array.
                        </Text>
                      )}
                    </Stack>
                  </Stack>
                ) : (
                  <Stack gap={4}>
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm" fw={500} truncate style={{ flex: 1, minWidth: 0 }}>
                        {p.filename}
                      </Text>
                      <Badge size="xs" variant="filled" color="red">
                        error
                      </Badge>
                    </Group>
                    <Text size="xs" c="red">
                      {p.error}
                    </Text>
                  </Stack>
                )}
              </Card>
            )
          })}
        </Stack>
      )}

      {summary && (
        <Card withBorder p="sm">
          <Stack gap="xs">
            <Group gap="xs" wrap="nowrap">
              <Text size="sm" fw={500}>
                Exported {summary.succeeded}/{summary.total} files
              </Text>
              {summary.skipped > 0 && (
                <Badge size="xs" variant="light" color="gray">
                  {summary.skipped} skipped (unchanged)
                </Badge>
              )}
              <Badge
                size="xs"
                variant="filled"
                color={summary.succeeded === summary.total ? 'green' : 'orange'}
              >
                {summary.succeeded === summary.total ? 'all ok' : 'partial'}
              </Badge>
            </Group>
            {summary.rows.some((r) => r.ok && r.savedPath) && (
              <Text size="xs" c="dimmed">
                Server-saved to <code>data/exports/</code>:
              </Text>
            )}
            <Stack gap={2}>
              {summary.rows
                .filter((r) => r.ok && r.savedPath)
                .map((r) => (
                  <Group key={r.filename} gap="xs" wrap="nowrap">
                    <Text size="xs" ff="monospace" truncate style={{ flex: 1, minWidth: 0 }}>
                      {r.savedPath}
                    </Text>
                    {r.skipped && (
                      <Badge size="xs" variant="light" color="gray">
                        skipped
                      </Badge>
                    )}
                  </Group>
                ))}
            </Stack>
            {summary.rows.some((r) => !r.ok) && (
              <>
                <Text size="xs" c="red">
                  Failed:
                </Text>
                <Stack gap={2}>
                  {summary.rows
                    .filter((r) => !r.ok)
                    .map((r) => (
                      <Text key={r.filename} size="xs" ff="monospace">
                        {r.filename}: {r.error}
                      </Text>
                    ))}
                </Stack>
              </>
            )}
          </Stack>
        </Card>
      )}
    </Stack>
  )
}
