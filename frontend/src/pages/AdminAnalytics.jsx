import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'

function getUserRole(token) {
  try {
    return JSON.parse(atob(token.split('.')[1])).role
  } catch {
    return null
  }
}

function defaultDateRange() {
  const to = new Date()
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

export default function AdminAnalytics() {
  const navigate = useNavigate()
  const token = localStorage.getItem('token')
  const role = token ? getUserRole(token) : null
  const [dateRange, setDateRange] = useState(defaultDateRange)
  const [volumeData, setVolumeData] = useState([])
  const [approvalData, setApprovalData] = useState([])
  const [rejectionData, setRejectionData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exportingCsv, setExportingCsv] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)

  useEffect(() => {
    const t = localStorage.getItem('token')
    if (!t) { navigate('/login'); return }
    if (getUserRole(t) !== 'admin') { navigate('/dashboard'); return }
  }, [navigate])

  useEffect(() => {
    fetchAnalytics()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchAnalytics() {
    const t = localStorage.getItem('token')
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to })
      const [volRes, appRes, rejRes] = await Promise.all([
        fetch(`/api/admin/analytics/volume?${params}`, { headers: { Authorization: `Bearer ${t}` } }),
        fetch(`/api/admin/analytics/approval-time?${params}`, { headers: { Authorization: `Bearer ${t}` } }),
        fetch(`/api/admin/analytics/rejection-rate?${params}`, { headers: { Authorization: `Bearer ${t}` } }),
      ])
      if (volRes.status === 401 || appRes.status === 401 || rejRes.status === 401) { navigate('/login'); return }
      if (volRes.status === 403 || appRes.status === 403 || rejRes.status === 403) { navigate('/dashboard'); return }
      if (!volRes.ok || !appRes.ok || !rejRes.ok) { setError('Failed to load analytics data.'); return }
      const [vol, app, rej] = await Promise.all([volRes.json(), appRes.json(), rejRes.json()])
      setVolumeData(vol)
      setApprovalData(app)
      setRejectionData(rej)
    } catch {
      setError('Failed to load analytics data.')
    } finally {
      setLoading(false)
    }
  }

  async function handleExport(format) {
    const t = localStorage.getItem('token')
    const setter = format === 'csv' ? setExportingCsv : setExportingPdf
    setter(true)
    try {
      const params = new URLSearchParams({ format, from: dateRange.from, to: dateRange.to })
      const res = await fetch(`/api/admin/analytics/export?${params}`, { headers: { Authorization: `Bearer ${t}` } })
      if (!res.ok) { alert('Export failed. Please try again.'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `docflow-report-${dateRange.from}-${dateRange.to}.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      alert('Export failed. Please try again.')
    } finally {
      setter(false)
    }
  }

  function handleApply(e) {
    e.preventDefault()
    fetchAnalytics()
  }

  function handleLogout() {
    localStorage.removeItem('token')
    navigate('/login')
  }

  // Summary stats
  const totalSubmitted = volumeData.reduce((s, r) => s + r.submitted, 0)
  const totalApproved = volumeData.reduce((s, r) => s + r.approved, 0)
  const totalRejected = volumeData.reduce((s, r) => s + r.rejected, 0)
  const totalDecided = totalApproved + totalRejected
  const overallRejRate = totalDecided > 0 ? ((totalRejected / totalDecided) * 100).toFixed(1) : '—'
  const approvalSamples = approvalData.filter(r => r.avgApprovalTimeMs != null)
  const overallAvgDays = approvalSamples.length > 0
    ? (approvalSamples.reduce((s, r) => s + r.avgApprovalTimeMs, 0) / approvalSamples.length / 86400000).toFixed(2)
    : '—'

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <div style={styles.logo}>DocFlow</div>
        <nav style={styles.nav}>
          <Link to="/dashboard" style={styles.navItem}>Dashboard</Link>
          <Link to="/documents" style={styles.navItem}>Documents</Link>
          <a href="#" style={styles.navItem}>Workflows</a>
          <Link to="/approvals" style={styles.navItem}>Approvals</Link>
          <Link to="/admin/settings" style={styles.navItem}>Settings</Link>
          {role === 'admin' && (
            <>
              <Link to="/admin/routing-rules" style={styles.navItem}>Routing Rules</Link>
              <Link to="/admin/users" style={styles.navItem}>Manage Users</Link>
              <Link to="/admin/roles" style={styles.navItem}>Manage Roles</Link>
              <Link to="/admin/audit-logs" style={styles.navItem}>Audit Logs</Link>
              <Link to="/admin/analytics" style={{ ...styles.navItem, ...styles.navItemActive }}>Analytics</Link>
            </>
          )}
        </nav>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.pageTitle}>Analytics</h1>
          <div style={styles.headerActions}>
            <form onSubmit={handleApply} style={styles.dateForm}>
              <label style={styles.dateLabel}>From</label>
              <input
                type="date"
                style={styles.dateInput}
                value={dateRange.from}
                onChange={e => setDateRange(r => ({ ...r, from: e.target.value }))}
              />
              <label style={styles.dateLabel}>To</label>
              <input
                type="date"
                style={styles.dateInput}
                value={dateRange.to}
                onChange={e => setDateRange(r => ({ ...r, to: e.target.value }))}
              />
              <button type="submit" style={styles.applyBtn}>Apply</button>
            </form>
            <button
              style={{ ...styles.exportBtn, opacity: exportingCsv ? 0.7 : 1 }}
              disabled={exportingCsv}
              onClick={() => handleExport('csv')}
            >
              {exportingCsv ? <span style={styles.spinner} /> : null}
              {exportingCsv ? 'Exporting…' : 'Export CSV'}
            </button>
            <button
              style={{ ...styles.exportBtn, ...styles.exportBtnPdf, opacity: exportingPdf ? 0.7 : 1 }}
              disabled={exportingPdf}
              onClick={() => handleExport('pdf')}
            >
              {exportingPdf ? <span style={styles.spinner} /> : null}
              {exportingPdf ? 'Exporting…' : 'Export PDF'}
            </button>
          </div>
        </header>

        <div style={styles.content}>
          {loading && <p style={styles.message}>Loading…</p>}
          {error && <p style={{ ...styles.message, color: '#dc2626' }}>{error}</p>}

          {!loading && !error && (
            <>
              {/* Summary cards */}
              <div style={styles.cards}>
                <div style={styles.card}>
                  <div style={styles.cardLabel}>Submitted</div>
                  <div style={styles.cardValue}>{totalSubmitted}</div>
                </div>
                <div style={styles.card}>
                  <div style={styles.cardLabel}>Approved</div>
                  <div style={{ ...styles.cardValue, color: '#16a34a' }}>{totalApproved}</div>
                </div>
                <div style={styles.card}>
                  <div style={styles.cardLabel}>Rejected</div>
                  <div style={{ ...styles.cardValue, color: '#dc2626' }}>{totalRejected}</div>
                </div>
                <div style={styles.card}>
                  <div style={styles.cardLabel}>Rejection Rate</div>
                  <div style={styles.cardValue}>{overallRejRate}{overallRejRate !== '—' ? '%' : ''}</div>
                </div>
                <div style={styles.card}>
                  <div style={styles.cardLabel}>Avg Approval Time</div>
                  <div style={styles.cardValue}>{overallAvgDays}{overallAvgDays !== '—' ? ' days' : ''}</div>
                </div>
              </div>

              {/* Processing volume table */}
              <div style={styles.section}>
                <h2 style={styles.sectionTitle}>Processing Volume</h2>
                {volumeData.length === 0 ? (
                  <p style={styles.emptyText}>No data for this period.</p>
                ) : (
                  <div style={styles.tableWrapper}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Date</th>
                          <th style={styles.th}>Submitted</th>
                          <th style={styles.th}>Approved</th>
                          <th style={styles.th}>Rejected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {volumeData.map(r => (
                          <tr key={r.date} style={styles.row}>
                            <td style={styles.tdMono}>{r.date}</td>
                            <td style={styles.td}>{r.submitted}</td>
                            <td style={{ ...styles.td, color: '#16a34a' }}>{r.approved}</td>
                            <td style={{ ...styles.td, color: '#dc2626' }}>{r.rejected}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Approval time table */}
              <div style={styles.section}>
                <h2 style={styles.sectionTitle}>Average Approval Time</h2>
                {approvalData.length === 0 ? (
                  <p style={styles.emptyText}>No data for this period.</p>
                ) : (
                  <div style={styles.tableWrapper}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Date</th>
                          <th style={styles.th}>Avg Approval Time (days)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {approvalData.map(r => (
                          <tr key={r.date} style={styles.row}>
                            <td style={styles.tdMono}>{r.date}</td>
                            <td style={styles.td}>
                              {r.avgApprovalTimeMs != null
                                ? (r.avgApprovalTimeMs / 86400000).toFixed(2)
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Rejection rate table */}
              <div style={styles.section}>
                <h2 style={styles.sectionTitle}>Rejection Rate</h2>
                {rejectionData.length === 0 ? (
                  <p style={styles.emptyText}>No data for this period.</p>
                ) : (
                  <div style={styles.tableWrapper}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Date</th>
                          <th style={styles.th}>Rejection Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rejectionData.map(r => (
                          <tr key={r.date} style={styles.row}>
                            <td style={styles.tdMono}>{r.date}</td>
                            <td style={{ ...styles.td, color: r.rejectionRate > 0.2 ? '#dc2626' : '#374151' }}>
                              {r.rejectionRate != null ? `${(r.rejectionRate * 100).toFixed(1)}%` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

const styles = {
  layout: { display: 'flex', minHeight: '100vh' },
  sidebar: {
    width: '220px',
    background: '#1e293b',
    color: '#f1f5f9',
    display: 'flex',
    flexDirection: 'column',
    padding: '1.5rem 1rem',
    gap: '0.5rem',
    flexShrink: 0,
  },
  logo: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: '#60a5fa',
    padding: '0.5rem 0.75rem',
    marginBottom: '1rem',
  },
  nav: { display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 },
  navItem: {
    padding: '0.625rem 0.75rem',
    borderRadius: '6px',
    color: '#94a3b8',
    fontSize: '0.9rem',
    fontWeight: 500,
    textDecoration: 'none',
    display: 'block',
  },
  navItemActive: { background: '#334155', color: '#f1f5f9' },
  logoutBtn: {
    marginTop: 'auto',
    padding: '0.625rem 0.75rem',
    background: 'transparent',
    border: '1px solid #334155',
    borderRadius: '6px',
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: '0.875rem',
    textAlign: 'left',
  },
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' },
  header: {
    padding: '1.5rem 2rem',
    borderBottom: '1px solid #e5e7eb',
    background: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '1rem',
  },
  pageTitle: { fontSize: '1.25rem', fontWeight: 600, color: '#111827' },
  headerActions: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' },
  dateForm: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  dateLabel: { fontSize: '0.875rem', color: '#6b7280' },
  dateInput: {
    padding: '0.4rem 0.6rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.875rem',
    color: '#111827',
  },
  applyBtn: {
    padding: '0.4rem 0.875rem',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
  exportBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.4rem 0.875rem',
    background: '#16a34a',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
  exportBtnPdf: { background: '#7c3aed' },
  spinner: {
    display: 'inline-block',
    width: '12px',
    height: '12px',
    border: '2px solid rgba(255,255,255,0.4)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
  content: { padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' },
  message: { color: '#6b7280', fontSize: '1rem' },
  cards: { display: 'flex', gap: '1rem', flexWrap: 'wrap' },
  card: {
    flex: '1 1 140px',
    background: '#fff',
    borderRadius: '10px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    padding: '1.25rem 1.5rem',
  },
  cardLabel: { fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' },
  cardValue: { fontSize: '1.75rem', fontWeight: 700, color: '#111827' },
  section: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  sectionTitle: { fontSize: '1rem', fontWeight: 600, color: '#111827' },
  emptyText: { color: '#6b7280', fontSize: '0.875rem' },
  tableWrapper: {
    background: '#fff',
    borderRadius: '10px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    overflow: 'auto',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' },
  th: {
    padding: '0.75rem 1rem',
    textAlign: 'left',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid #e5e7eb',
    background: '#f9fafb',
    whiteSpace: 'nowrap',
  },
  row: { borderBottom: '1px solid #f3f4f6' },
  td: { padding: '0.75rem 1rem', color: '#111827', verticalAlign: 'middle' },
  tdMono: { padding: '0.75rem 1rem', color: '#374151', verticalAlign: 'middle', fontFamily: 'monospace', fontSize: '0.8rem' },
}
