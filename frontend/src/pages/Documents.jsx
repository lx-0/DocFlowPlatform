import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'

const ROUTING_STATUS_COLORS = {
  unrouted:    { bg: '#f3f4f6', color: '#6b7280', label: 'Unrouted' },
  queued:      { bg: '#eff6ff', color: '#2563eb', label: 'Queued' },
  in_approval: { bg: '#fef9c3', color: '#b45309', label: 'In Approval' },
  approved:    { bg: '#f0fdf4', color: '#16a34a', label: 'Approved' },
  rejected:    { bg: '#fef2f2', color: '#dc2626', label: 'Rejected' },
}

function StatusChip({ status }) {
  const cfg = ROUTING_STATUS_COLORS[status] || { bg: '#f3f4f6', color: '#6b7280', label: status }
  return (
    <span style={{ ...styles.chip, background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  )
}

function getUserRole(token) {
  try {
    return JSON.parse(atob(token.split('.')[1])).role
  } catch {
    return null
  }
}

export default function Documents() {
  const navigate = useNavigate()
  const token = localStorage.getItem('token')
  const role = token ? getUserRole(token) : null
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { navigate('/login'); return }

    fetch('/api/documents', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        if (res.status === 401) { navigate('/login'); return null }
        return res.json()
      })
      .then(data => { if (data) setDocuments(data.documents) })
      .catch(() => setError('Failed to load documents.'))
      .finally(() => setLoading(false))
  }, [navigate, token])

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
          <Link to="/documents" style={{ ...styles.navItem, ...styles.navItemActive }}>Documents</Link>
          <Link to="/dashboard" style={styles.navItem}>Workflows</Link>
          <Link to="/approvals" style={styles.navItem}>Approvals</Link>
          <Link to="/dashboard" style={styles.navItem}>Settings</Link>
          {role === 'admin' && (
            <Link to="/admin/routing-rules" style={styles.navItem}>Routing Rules</Link>
          )}
        </nav>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.pageTitle}>My Documents</h1>
        </header>

        <div style={styles.content}>
          {loading && <p style={styles.message}>Loading…</p>}
          {error && <p style={{ ...styles.message, color: '#dc2626' }}>{error}</p>}

          {!loading && !error && (
            <div style={styles.card}>
              {documents.length === 0 ? (
                <p style={styles.emptyMsg}>No documents uploaded yet.</p>
              ) : (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Filename</th>
                      <th style={styles.th}>Type</th>
                      <th style={styles.th}>Size</th>
                      <th style={styles.th}>Approval Status</th>
                      <th style={styles.th}>Uploaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map(doc => (
                      <tr
                        key={doc.id}
                        style={styles.tr}
                        onClick={() => navigate(`/documents/${doc.id}`)}
                      >
                        <td style={styles.td}>{doc.originalFilename}</td>
                        <td style={styles.td}>{doc.mimeType === 'application/pdf' ? 'PDF' : 'DOCX'}</td>
                        <td style={styles.td}>{(doc.sizeBytes / 1024).toFixed(1)} KB</td>
                        <td style={styles.td}>
                          <StatusChip status={doc.routingStatus || 'unrouted'} />
                        </td>
                        <td style={styles.td}>{new Date(doc.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
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
  },
  pageTitle: { fontSize: '1.25rem', fontWeight: 600, color: '#111827' },
  content: { padding: '2rem' },
  message: { color: '#6b7280', fontSize: '1rem' },
  card: {
    background: '#fff',
    borderRadius: '10px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  emptyMsg: { padding: '2rem', textAlign: 'center', color: '#6b7280' },
  table: { width: '100%', borderCollapse: 'collapse' },
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
  tr: {
    cursor: 'pointer',
    borderBottom: '1px solid #f3f4f6',
  },
  td: {
    padding: '0.875rem 1rem',
    fontSize: '0.9rem',
    color: '#111827',
  },
  chip: {
    display: 'inline-block',
    padding: '0.2rem 0.6rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: 600,
  },
}
