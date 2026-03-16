import NotificationBell from '../components/NotificationBell'
import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'

function getUserRole(token) {
  try {
    return JSON.parse(atob(token.split('.')[1])).role
  } catch {
    return null
  }
}

const ACTION_COLORS = {
  'user.login': { bg: '#dcfce7', color: '#166534' },
  'user.login_failed': { bg: '#fee2e2', color: '#991b1b' },
  'user.role_changed': { bg: '#fef9c3', color: '#854d0e' },
  'document.viewed': { bg: '#e0e7ff', color: '#3730a3' },
  'document.approved': { bg: '#dcfce7', color: '#166534' },
  'document.rejected': { bg: '#fee2e2', color: '#991b1b' },
  'document.changes_requested': { bg: '#ffedd5', color: '#9a3412' },
}

function ActionChip({ action }) {
  const c = ACTION_COLORS[action] || { bg: '#f3f4f6', color: '#374151' }
  return (
    <span style={{ display: 'inline-block', padding: '0.2rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600, background: c.bg, color: c.color }}>
      {action}
    </span>
  )
}

export default function AdminAuditLogs() {
  const navigate = useNavigate()
  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ actorUserId: '', action: '', from: '', to: '' })
  const token = localStorage.getItem('token')
  const role = token ? getUserRole(token) : null
  const LIMIT = 50

  useEffect(() => {
    const t = localStorage.getItem('token')
    if (!t) { navigate('/login'); return }
    if (getUserRole(t) !== 'admin') { navigate('/dashboard'); return }
  }, [navigate])

  useEffect(() => {
    fetchLogs()
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchLogs(resetPage = false) {
    const t = localStorage.getItem('token')
    const currentPage = resetPage ? 1 : page
    if (resetPage) setPage(1)
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: currentPage, limit: LIMIT })
      if (filters.actorUserId) params.set('actorUserId', filters.actorUserId)
      if (filters.action) params.set('action', filters.action)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)

      const res = await fetch(`/api/admin/audit-logs?${params}`, { headers: { Authorization: `Bearer ${t}` } })
      if (res.status === 401) { navigate('/login'); return }
      if (res.status === 403) { navigate('/dashboard'); return }
      if (!res.ok) { setError('Failed to load audit logs.'); return }
      const data = await res.json()
      setLogs(data.logs)
      setTotal(data.total)
    } catch {
      setError('Failed to load audit logs.')
    } finally {
      setLoading(false)
    }
  }

  function handleFilterSubmit(e) {
    e.preventDefault()
    fetchLogs(true)
  }

  function handleLogout() {
    localStorage.removeItem('token')
    navigate('/login')
  }

  const totalPages = Math.ceil(total / LIMIT)

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
              <Link to="/admin/audit-logs" style={{ ...styles.navItem, ...styles.navItemActive }}>Audit Logs</Link>
            </>
          )}
        </nav>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.pageTitle}>Audit Logs</h1>
          <NotificationBell />
        </header>
        <div style={styles.content}>
          {/* Filters */}
          <form onSubmit={handleFilterSubmit} style={styles.filterBar}>
            <input
              style={styles.input}
              placeholder="Actor user ID"
              value={filters.actorUserId}
              onChange={e => setFilters(f => ({ ...f, actorUserId: e.target.value }))}
            />
            <input
              style={styles.input}
              placeholder="Action (e.g. user.login)"
              value={filters.action}
              onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}
            />
            <input
              style={styles.input}
              type="datetime-local"
              title="From"
              value={filters.from}
              onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
            />
            <input
              style={styles.input}
              type="datetime-local"
              title="To"
              value={filters.to}
              onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
            />
            <button type="submit" style={styles.filterBtn}>Filter</button>
          </form>

          {loading && <p style={styles.message}>Loading…</p>}
          {error && <p style={{ ...styles.message, color: '#dc2626' }}>{error}</p>}

          {!loading && !error && logs.length === 0 && (
            <div style={styles.empty}>
              <p style={styles.emptyText}>No audit log entries found.</p>
            </div>
          )}

          {!loading && logs.length > 0 && (
            <>
              <div style={styles.tableWrapper}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Timestamp</th>
                      <th style={styles.th}>Action</th>
                      <th style={styles.th}>Actor</th>
                      <th style={styles.th}>Target</th>
                      <th style={styles.th}>IP Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log.id} style={styles.row}>
                        <td style={styles.td}>
                          <span style={styles.timestamp}>{new Date(log.createdAt).toLocaleString()}</span>
                        </td>
                        <td style={styles.td}>
                          <ActionChip action={log.action} />
                        </td>
                        <td style={styles.tdMono}>{log.actorUserId || <span style={styles.system}>system</span>}</td>
                        <td style={styles.tdMono}>
                          <span style={styles.targetType}>{log.targetType}</span>
                          {' '}{log.targetId}
                        </td>
                        <td style={styles.tdMono}>{log.ipAddress || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div style={styles.pagination}>
                <span style={styles.pageInfo}>
                  {total} total &mdash; page {page} of {totalPages}
                </span>
                <div style={styles.pageButtons}>
                  <button style={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                  <button style={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
                </div>
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
  },
  pageTitle: { fontSize: '1.25rem', fontWeight: 600, color: '#111827' },
  content: { padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' },
  filterBar: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' },
  input: {
    padding: '0.5rem 0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.875rem',
    color: '#111827',
    background: '#fff',
    minWidth: '180px',
  },
  filterBtn: {
    padding: '0.5rem 1rem',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
  message: { color: '#6b7280', fontSize: '1rem' },
  empty: {
    background: '#fff',
    borderRadius: '10px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    padding: '3rem',
    textAlign: 'center',
  },
  emptyText: { color: '#6b7280', fontSize: '1rem' },
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
  tdMono: { padding: '0.75rem 1rem', color: '#374151', verticalAlign: 'middle', fontFamily: 'monospace', fontSize: '0.8rem', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  timestamp: { color: '#6b7280', fontSize: '0.8rem', whiteSpace: 'nowrap' },
  system: { color: '#9ca3af', fontStyle: 'italic' },
  targetType: {
    display: 'inline-block',
    padding: '0.15rem 0.4rem',
    borderRadius: '4px',
    fontSize: '0.7rem',
    fontWeight: 600,
    background: '#f3f4f6',
    color: '#6b7280',
    marginRight: '0.25rem',
  },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  pageInfo: { fontSize: '0.875rem', color: '#6b7280' },
  pageButtons: { display: 'flex', gap: '0.5rem' },
  pageBtn: {
    padding: '0.5rem 1rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.875rem',
    background: '#fff',
    color: '#374151',
    cursor: 'pointer',
  },
}
