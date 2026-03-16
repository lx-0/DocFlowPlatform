import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

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

function presetRange(days) {
  const to = new Date()
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
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

  async function fetchAnalytics(range) {
    const t = localStorage.getItem('token')
    const r = range || dateRange
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ from: r.from, to: r.to })
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
      setApprovalData(app.map(r => ({
        ...r,
        avgDays: r.avgApprovalTimeMs != null ? parseFloat((r.avgApprovalTimeMs / 86400000).toFixed(2)) : null,
      })))
      setRejectionData(rej.map(r => ({
        ...r,
        ratePercent: r.rejectionRate != null ? parseFloat((r.rejectionRate * 100).toFixed(1)) : null,
      })))
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

  function handlePreset(days) {
    const range = presetRange(days)
    setDateRange(range)
    fetchAnalytics(range)
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
            <div style={styles.presetBtns}>
              {[7, 30, 90].map(d => (
                <button key={d} style={styles.presetBtn} onClick={() => handlePreset(d)}>
                  {d}d
                </button>
              ))}
            </div>
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

              {/* Volume chart */}
              <div style={styles.section}>
                <h2 style={styles.sectionTitle}>Processing Volume</h2>
                {volumeData.length === 0 ? (
                  <p style={styles.emptyText}>No data for this period.</p>
                ) : (
                  <div style={styles.chartCard}>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={volumeData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                        <Bar dataKey="submitted" name="Submitted" fill="#60a5fa" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="approved" name="Approved" fill="#4ade80" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="rejected" name="Rejected" fill="#f87171" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Approval time chart */}
              <div style={styles.section}>
                <h2 style={styles.sectionTitle}>Average Approval Time (days)</h2>
                {approvalData.length === 0 ? (
                  <p style={styles.emptyText}>No data for this period.</p>
                ) : (
                  <div style={styles.chartCard}>
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={approvalData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} unit=" d" />
                        <Tooltip contentStyle={tooltipStyle} formatter={v => v != null ? `${v} days` : '—'} />
                        <Line
                          type="monotone"
                          dataKey="avgDays"
                          name="Avg Approval Time"
                          stroke="#818cf8"
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Rejection rate chart */}
              <div style={styles.section}>
                <h2 style={styles.sectionTitle}>Rejection Rate (%)</h2>
                {rejectionData.length === 0 ? (
                  <p style={styles.emptyText}>No data for this period.</p>
                ) : (
                  <div style={styles.chartCard}>
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={rejectionData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
                        <Tooltip contentStyle={tooltipStyle} formatter={v => v != null ? `${v}%` : '—'} />
                        <Line
                          type="monotone"
                          dataKey="ratePercent"
                          name="Rejection Rate"
                          stroke="#fb923c"
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
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

const tooltipStyle = {
  fontSize: '0.8rem',
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
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
  presetBtns: { display: 'flex', gap: '0.375rem' },
  presetBtn: {
    padding: '0.35rem 0.6rem',
    background: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.8rem',
    fontWeight: 500,
    color: '#374151',
    cursor: 'pointer',
  },
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
  chartCard: {
    background: '#fff',
    borderRadius: '10px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    padding: '1.5rem 1rem 1rem',
  },
}
