import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'

function getUserRole(token) {
  try {
    return JSON.parse(atob(token.split('.')[1])).role
  } catch {
    return null
  }
}

export default function AdminSettings() {
  const navigate = useNavigate()
  const token = localStorage.getItem('token')
  const role = token ? getUserRole(token) : null

  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const [docDays, setDocDays] = useState('')
  const [auditDays, setAuditDays] = useState('')

  useEffect(() => {
    const t = localStorage.getItem('token')
    if (!t) { navigate('/login'); return }
    if (getUserRole(t) !== 'admin') { navigate('/dashboard'); return }
  }, [navigate])

  useEffect(() => {
    fetchSettings()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchSettings() {
    const t = localStorage.getItem('token')
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/settings', { headers: { Authorization: `Bearer ${t}` } })
      if (res.status === 401) { navigate('/login'); return }
      if (res.status === 403) { navigate('/dashboard'); return }
      if (!res.ok) { setError('Failed to load settings.'); return }
      const data = await res.json()
      setSettings(data)
      setDocDays(String(data.documentRetentionDays))
      setAuditDays(String(data.auditLogRetentionDays))
    } catch {
      setError('Failed to load settings.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    const t = localStorage.getItem('token')
    setSaving(true)
    setSaveMsg('')
    setError('')
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({
          documentRetentionDays: parseInt(docDays, 10),
          auditLogRetentionDays: parseInt(auditDays, 10),
        }),
      })
      if (res.status === 401) { navigate('/login'); return }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || 'Failed to save settings.')
        return
      }
      const data = await res.json()
      setSettings(data)
      setSaveMsg('Settings saved.')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch {
      setError('Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem('token')
    navigate('/login')
  }

  function formatDate(iso) {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <div style={styles.logo}>DocFlow</div>
        <nav style={styles.nav}>
          <Link to="/dashboard" style={styles.navItem}>Dashboard</Link>
          <Link to="/documents" style={styles.navItem}>Documents</Link>
          <Link to="/approvals" style={styles.navItem}>Approvals</Link>
          {role === 'admin' && (
            <>
              <Link to="/admin/routing-rules" style={styles.navItem}>Routing Rules</Link>
              <Link to="/admin/users" style={styles.navItem}>Manage Users</Link>
              <Link to="/admin/roles" style={styles.navItem}>Manage Roles</Link>
              <Link to="/admin/audit-logs" style={styles.navItem}>Audit Logs</Link>
              <Link to="/admin/analytics" style={styles.navItem}>Analytics</Link>
              <Link to="/admin/settings" style={{ ...styles.navItem, ...styles.navItemActive }}>Settings</Link>
            </>
          )}
        </nav>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.pageTitle}>System Settings</h1>
        </header>

        {error && <div style={styles.errorBanner}>{error}</div>}

        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading settings…</p>
        ) : (
          <>
            <section style={styles.card}>
              <h2 style={styles.sectionTitle}>Retention Policy</h2>
              <p style={styles.sectionDesc}>
                Configure how long documents and audit logs are retained before automatic purging.
                Set <strong>Document Retention</strong> to 0 to disable automatic document archiving.
              </p>

              <form onSubmit={handleSave}>
                <div style={styles.fieldGroup}>
                  <label style={styles.label} htmlFor="docDays">
                    Document Retention (days)
                  </label>
                  <p style={styles.fieldHint}>
                    Approved/rejected documents older than this many days will be soft-deleted.
                    Default: 365. Set to 0 to disable.
                  </p>
                  <input
                    id="docDays"
                    type="number"
                    min="0"
                    value={docDays}
                    onChange={(e) => setDocDays(e.target.value)}
                    style={styles.input}
                    required
                  />
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.label} htmlFor="auditDays">
                    Audit Log Retention (days)
                  </label>
                  <p style={styles.fieldHint}>
                    Audit log records older than this many days will be permanently deleted.
                    Default: 90. Minimum: 1.
                  </p>
                  <input
                    id="auditDays"
                    type="number"
                    min="1"
                    value={auditDays}
                    onChange={(e) => setAuditDays(e.target.value)}
                    style={styles.input}
                    required
                  />
                </div>

                <div style={styles.saveRow}>
                  <button type="submit" disabled={saving} style={styles.saveBtn}>
                    {saving ? 'Saving…' : 'Save Settings'}
                  </button>
                  {saveMsg && <span style={styles.saveMsg}>{saveMsg}</span>}
                </div>
              </form>
            </section>

            <section style={styles.card}>
              <h2 style={styles.sectionTitle}>Last Purge Run</h2>
              {settings && (
                <table style={styles.statsTable}>
                  <tbody>
                    <tr>
                      <td style={styles.statLabel}>Last run at</td>
                      <td style={styles.statValue}>{formatDate(settings.lastPurgeAt)}</td>
                    </tr>
                    <tr>
                      <td style={styles.statLabel}>Documents archived</td>
                      <td style={styles.statValue}>
                        {settings.lastPurgeDocumentsArchived != null ? settings.lastPurgeDocumentsArchived : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td style={styles.statLabel}>Audit logs deleted</td>
                      <td style={styles.statValue}>
                        {settings.lastPurgeLogsDeleted != null ? settings.lastPurgeLogsDeleted : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
              <p style={{ ...styles.fieldHint, marginTop: '0.75rem' }}>
                The purge job runs automatically every night at 03:00 server time.
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

const styles = {
  layout: {
    display: 'flex',
    minHeight: '100vh',
    fontFamily: "'Inter', system-ui, sans-serif",
    background: '#f9fafb',
    color: '#111827',
  },
  sidebar: {
    width: 220,
    background: '#1e293b',
    color: '#f1f5f9',
    display: 'flex',
    flexDirection: 'column',
    padding: '1.5rem 0',
    flexShrink: 0,
  },
  logo: {
    fontSize: '1.25rem',
    fontWeight: 700,
    padding: '0 1.25rem 1.5rem',
    color: '#f1f5f9',
    letterSpacing: '-0.01em',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
  },
  navItem: {
    padding: '0.6rem 1.25rem',
    color: '#cbd5e1',
    textDecoration: 'none',
    fontSize: '0.9rem',
    transition: 'background 0.15s',
  },
  navItemActive: {
    background: '#334155',
    color: '#f1f5f9',
    fontWeight: 600,
  },
  logoutBtn: {
    margin: '1rem 1.25rem 0',
    padding: '0.5rem',
    background: 'transparent',
    border: '1px solid #475569',
    borderRadius: 6,
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '2rem',
    maxWidth: 760,
  },
  header: {
    marginBottom: '1.5rem',
  },
  pageTitle: {
    fontSize: '1.5rem',
    fontWeight: 700,
    margin: 0,
  },
  errorBanner: {
    background: '#fee2e2',
    color: '#991b1b',
    padding: '0.75rem 1rem',
    borderRadius: 8,
    marginBottom: '1rem',
    fontSize: '0.9rem',
  },
  card: {
    background: '#fff',
    borderRadius: 10,
    border: '1px solid #e5e7eb',
    padding: '1.5rem',
    marginBottom: '1.5rem',
  },
  sectionTitle: {
    fontSize: '1.05rem',
    fontWeight: 600,
    margin: '0 0 0.4rem',
  },
  sectionDesc: {
    fontSize: '0.875rem',
    color: '#6b7280',
    margin: '0 0 1.25rem',
  },
  fieldGroup: {
    marginBottom: '1.25rem',
  },
  label: {
    display: 'block',
    fontWeight: 600,
    fontSize: '0.875rem',
    marginBottom: '0.2rem',
  },
  fieldHint: {
    fontSize: '0.8rem',
    color: '#6b7280',
    margin: '0 0 0.4rem',
  },
  input: {
    width: 140,
    padding: '0.45rem 0.7rem',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: '0.9rem',
    outline: 'none',
  },
  saveRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    marginTop: '0.5rem',
  },
  saveBtn: {
    padding: '0.5rem 1.25rem',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontWeight: 600,
    fontSize: '0.9rem',
    cursor: 'pointer',
  },
  saveMsg: {
    color: '#16a34a',
    fontSize: '0.875rem',
    fontWeight: 500,
  },
  statsTable: {
    borderCollapse: 'collapse',
    fontSize: '0.875rem',
  },
  statLabel: {
    padding: '0.4rem 1rem 0.4rem 0',
    color: '#6b7280',
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  statValue: {
    padding: '0.4rem 0',
    fontWeight: 600,
  },
}
