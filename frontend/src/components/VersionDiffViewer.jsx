import { useState } from 'react'

/**
 * Side-by-side diff viewer for document versions.
 *
 * Props:
 *   documentId: string       — document to diff
 *   versions: Array          — list of version objects (sorted newest-first)
 *   token: string            — auth token
 */
export default function VersionDiffViewer({ documentId, versions, token }) {
  const [fromVersion, setFromVersion] = useState('')
  const [toVersion, setToVersion] = useState('')
  const [diff, setDiff] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const docxVersions = versions.filter(v =>
    v.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )

  async function loadDiff() {
    if (!fromVersion || !toVersion || fromVersion === toVersion) {
      setError('Select two different versions to compare.')
      return
    }
    setError('')
    setDiff(null)
    setLoading(true)
    try {
      const res = await fetch(
        `/api/documents/${documentId}/versions/diff?from=${fromVersion}&to=${toVersion}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load diff')
      setDiff(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (docxVersions.length < 2) return null

  return (
    <div style={styles.container}>
      <h3 style={styles.heading}>Compare Versions</h3>
      <div style={styles.controls}>
        <label style={styles.selectLabel}>
          From
          <select
            value={fromVersion}
            onChange={e => setFromVersion(e.target.value)}
            style={styles.select}
          >
            <option value="">Select…</option>
            {docxVersions.map(v => (
              <option key={v.versionNumber} value={v.versionNumber}>
                v{v.versionNumber} — {v.originalFilename}
              </option>
            ))}
          </select>
        </label>
        <label style={styles.selectLabel}>
          To
          <select
            value={toVersion}
            onChange={e => setToVersion(e.target.value)}
            style={styles.select}
          >
            <option value="">Select…</option>
            {docxVersions.map(v => (
              <option key={v.versionNumber} value={v.versionNumber}>
                v{v.versionNumber} — {v.originalFilename}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={loadDiff}
          disabled={loading || !fromVersion || !toVersion}
          style={{
            ...styles.compareBtn,
            opacity: loading || !fromVersion || !toVersion ? 0.5 : 1,
          }}
        >
          {loading ? 'Loading…' : 'Compare'}
        </button>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      {diff && (
        <div>
          <div style={styles.summary}>
            <span style={styles.summaryAdded}>+{diff.summary.added} added</span>
            <span style={styles.summaryRemoved}>-{diff.summary.removed} removed</span>
            <span style={styles.summaryEqual}>{diff.summary.unchanged} unchanged</span>
          </div>
          <div style={styles.diffGrid}>
            <div style={styles.diffColumn}>
              <div style={styles.diffColHeader}>v{diff.fromVersion} (old)</div>
              {diff.changes.map((c, i) => (
                <div
                  key={i}
                  style={{
                    ...styles.diffLine,
                    ...(c.type === 'removed' ? styles.lineRemoved : {}),
                    ...(c.type === 'added' ? styles.lineAddedPlaceholder : {}),
                    ...(c.type === 'equal' ? styles.lineEqual : {}),
                  }}
                >
                  {c.type === 'removed' && c.text}
                  {c.type === 'equal' && c.text}
                  {c.type === 'added' && '\u00A0'}
                </div>
              ))}
            </div>
            <div style={styles.diffColumn}>
              <div style={styles.diffColHeader}>v{diff.toVersion} (new)</div>
              {diff.changes.map((c, i) => (
                <div
                  key={i}
                  style={{
                    ...styles.diffLine,
                    ...(c.type === 'added' ? styles.lineAdded : {}),
                    ...(c.type === 'removed' ? styles.lineRemovedPlaceholder : {}),
                    ...(c.type === 'equal' ? styles.lineEqual : {}),
                  }}
                >
                  {c.type === 'added' && c.text}
                  {c.type === 'equal' && c.text}
                  {c.type === 'removed' && '\u00A0'}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  container: {
    marginTop: '0.5rem',
  },
  heading: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#374151',
    margin: '0 0 0.75rem',
  },
  controls: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '0.75rem',
    flexWrap: 'wrap',
  },
  selectLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    fontSize: '0.8rem',
    fontWeight: 500,
    color: '#6b7280',
  },
  select: {
    padding: '0.4rem 0.5rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.85rem',
    minWidth: '180px',
    outline: 'none',
  },
  compareBtn: {
    padding: '0.45rem 1rem',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.85rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: {
    color: '#dc2626',
    fontSize: '0.85rem',
    marginTop: '0.5rem',
  },
  summary: {
    display: 'flex',
    gap: '1rem',
    margin: '0.75rem 0 0.5rem',
    fontSize: '0.8rem',
    fontWeight: 600,
  },
  summaryAdded: { color: '#16a34a' },
  summaryRemoved: { color: '#dc2626' },
  summaryEqual: { color: '#6b7280' },
  diffGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '2px',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    overflow: 'hidden',
    maxHeight: '400px',
    overflowY: 'auto',
  },
  diffColumn: {
    display: 'flex',
    flexDirection: 'column',
  },
  diffColHeader: {
    padding: '0.4rem 0.75rem',
    background: '#f3f4f6',
    fontSize: '0.75rem',
    fontWeight: 700,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid #e5e7eb',
    position: 'sticky',
    top: 0,
  },
  diffLine: {
    padding: '0.25rem 0.75rem',
    fontSize: '0.85rem',
    fontFamily: 'inherit',
    minHeight: '1.5em',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  lineRemoved: {
    background: '#fef2f2',
    color: '#991b1b',
  },
  lineAdded: {
    background: '#f0fdf4',
    color: '#166534',
  },
  lineEqual: {
    background: '#fff',
    color: '#374151',
  },
  lineAddedPlaceholder: {
    background: '#fafafa',
    color: 'transparent',
  },
  lineRemovedPlaceholder: {
    background: '#fafafa',
    color: 'transparent',
  },
}
