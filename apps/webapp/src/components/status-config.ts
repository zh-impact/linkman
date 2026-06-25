export const LINK_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'yellow' },
  imported: { label: 'Imported', color: 'blue' },
  duplicate_removed: { label: 'Duplicate', color: 'gray' },
  filtered_internal: { label: 'Internal', color: 'orange' },
  filtered_similar: { label: 'Similar', color: 'orange' },
  dns_failed: { label: 'DNS Failed', color: 'red' },
  connection_refused: { label: 'Refused', color: 'red' },
  timeout: { label: 'Timeout', color: 'red' },
  success: { label: 'Available', color: 'green' },
  error: { label: 'Error', color: 'red' },
}

export const LINK_STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'imported', label: 'Imported' },
  { value: 'duplicate_removed', label: 'Duplicate' },
  { value: 'filtered_internal', label: 'Internal' },
  { value: 'filtered_similar', label: 'Similar' },
  { value: 'dns_failed', label: 'DNS Failed' },
  { value: 'connection_refused', label: 'Refused' },
  { value: 'timeout', label: 'Timeout' },
  { value: 'success', label: 'Available' },
  { value: 'error', label: 'Error' },
]

export const OP_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  import: { label: 'Import', color: 'blue' },
  deduplicate: { label: 'Deduplicate', color: 'violet' },
  filter_internal: { label: 'Filter Internal', color: 'orange' },
  filter_similar: { label: 'Filter Similar', color: 'yellow' },
  test_dns: { label: 'DNS Test', color: 'teal' },
  test_head: { label: 'HEAD Test', color: 'teal' },
  test_get: { label: 'GET Test', color: 'teal' },
  manual_tag: { label: 'Tag', color: 'gray' },
  manual_delete: { label: 'Delete', color: 'red' },
  rollback: { label: 'Rollback', color: 'pink' },
}
