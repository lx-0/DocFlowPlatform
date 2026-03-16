import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'

function getUserRole(token) {
  try {
    return JSON.parse(atob(token.split('.')[1])).role
  } catch {
    return null
  }
}

const STATUS_COLORS = {
  pending: { background: '#fef9c3', color: '#854d0e' },
  approved: { background: '#dcfce7', color: '#166534' },
  rejected: { background: '#fee2e2', color: '#991b1b' },
  changes_requested: { background: '#fce7f3', color: '#9d174d' },
}

function StatusChip({ status }) {
  const colors = STATUS_COLORS[status] || { background: '#f3f4f6', color: '#374151' }
  const label = status === 'changes_requested' ? 'Changes Requested' : status.charAt(0).toUpperCase() + status.slice(1)
  return (
    <span style={{ ...styles.chip, ...colors }}>{label}</span>
  )
}

export default function ApprovalQueue() {
  const navigate = useNavigate()
  const [workflows, setWorkflows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const token = localStorage.getItem('token')
  const role = token ? getUserRole(token) : null

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) { navigate('/login'); return }

    fetch('/api/approvals', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        if (res.status === 401) { navigate('/login'); return null }
        return res.json()
      })
      .then(data => {
        if (data) setWorkflows(data)
      })
      .catch(() => setError('Failed to load approval queue.'))
      .finally(() => setLoading(false))
  }, [navigate])

  function handleLogout() {
    localStorage.removeItem('token')
    navigate('/login')
  }

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <div style={styles.logo}>DocFlow</div>
        <nav style={styles.nav}>
          <Link to="/dashboard" style={styles.navItem}>Dashboard</Link>
          <Link to="/dashboard" style={styles.navItem}>Documents</Link>
          <Link to="/dashboard" style={styles.navItem}>Workflows</Link>
          <Link to="/approvals" style={{ ...styles.navItem, ...styles.navItemActive }}>Approvals</Link>
          <Link to="/dashboard" style={styles.navItem}>Settings</Link>
          {role === 'admin' && (
            <Link to="/admin/routing-rules" style={styles.navItem}>Routing Rules</Link>
          )}
        </nav>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.pageTitle}>Approval Queue</h1>
        </header>
        <div style={styles.content}>
          {loading && <p style={styles.message}>Loading…</p>}
          {error && <p style={{ ...styles.message, color: '#dc2626' }}>{error}</p>}
          {!loading && !error && workflows.length === 0 && (
            <div style={styles.empty}>
              <p style={styles.emptyText}>No documents awaiting your approval.</p>
            </div>
          )}
          {!loading && workflows.length > 0 && (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Document Title</th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Submitted By</th>
                    <th style={styles.th}>Date Queued</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Queue</th>
                  </tr>
                </thead>
                <tbody>
                  {workflows.map(wf => (
                    <tr
                      key={wf.id}
                      style={styles.row}
                      onClick={() => navigate(`/approvals/${wf.id}`)}
                    >
                      <td style={styles.td}>
                        {wf.document?.metadata?.title || wf.document?.originalFilename || '—'}
                      </td>
                      <td style={styles.td}>{wf.document?.metadata?.documentType || '—'}</td>
                      <td style={styles.td}>
                        {wf.document?.uploadedBy?.name || wf.document?.uploadedBy?.email || '—'}
                      </td>
                      <td style={styles.td}>{new Date(wf.createdAt).toLocaleDateString()}</td>
                      <td style={styles.td}><StatusChip status={wf.status} /></td>
                      <td style={styles.td}>{wf.queueName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

const styles = {
  layout: {
    display: 'flex',
    minHeight: '100vh',
  },
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
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    flex: 1,
  },
  navItem: {
    padding: '0.625rem 0.75rem',
    borderRadius: '6px',
    color: '#94a3b8',
    fontSize: '0.9rem',
    fontWeight: 500,
    textDecoration: 'none',
    display: 'block',
  },
  navItemActive: {
    background: '#334155',
    color: '#f1f5f9',
  },
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
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
  },
  header: {
    padding: '1.5rem 2rem',
    borderBottom: '1px solid #e5e7eb',
    background: '#fff',
  },
  pageTitle: {
    fontSize: '1.25rem',
    fontWeight: 600,
    color: '#111827',
  },
  content: {
    padding: '2rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  message: {
    color: '#6b7280',
    fontSize: '1rem',
  },
  empty: {
    background: '#fff',
    borderRadius: '10px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    padding: '3rem',
    textAlign: 'center',
  },
  emptyText: {
    color: '#6b7280',
    fontSize: '1rem',
  },
  tableWrapper: {
    background: '#fff',
    borderRadius: '10px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.9rem',
  },
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
  },
  row: {
    cursor: 'pointer',
    borderBottom: '1px solid #f3f4f6',
  },
  td: {
    padding: '0.875rem 1rem',
    color: '#111827',
    verticalAlign: 'middle',
  },
  chip: {
    display: 'inline-block',
    padding: '0.25rem 0.625rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: 600,
  },
}
