import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'

function getUserRole(token) {
  try {
    return JSON.parse(atob(token.split('.')[1])).role
  } catch {
    return null
  }
}

export default function AdminRoles() {
  const navigate = useNavigate()
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const token = localStorage.getItem('token')
  const role = token ? getUserRole(token) : null

  useEffect(() => {
    const t = localStorage.getItem('token')
    if (!t) { navigate('/login'); return }
    if (getUserRole(t) !== 'admin') { navigate('/dashboard'); return }

    fetch('/api/admin/roles', { headers: { Authorization: `Bearer ${t}` } })
      .then(res => {
        if (res.status === 401) { navigate('/login'); return null }
        if (res.status === 403) { navigate('/dashboard'); return null }
        return res.json()
      })
      .then(data => { if (data) setRoles(data) })
      .catch(() => setError('Failed to load roles.'))
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
          <Link to="/documents" style={styles.navItem}>Documents</Link>
          <a href="#" style={styles.navItem}>Workflows</a>
          <Link to="/approvals" style={styles.navItem}>Approvals</Link>
          <Link to="/admin/settings" style={styles.navItem}>Settings</Link>
          {role === 'admin' && (
            <>
              <Link to="/admin/routing-rules" style={styles.navItem}>Routing Rules</Link>
              <Link to="/admin/users" style={styles.navItem}>Manage Users</Link>
              <Link to="/admin/roles" style={{ ...styles.navItem, ...styles.navItemActive }}>Manage Roles</Link>
            </>
          )}
        </nav>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.pageTitle}>Roles &amp; Permissions</h1>
        </header>
        <div style={styles.content}>
          {loading && <p style={styles.message}>Loading…</p>}
          {error && <p style={{ ...styles.message, color: '#dc2626' }}>{error}</p>}
          {!loading && !error && roles.length === 0 && (
            <div style={styles.empty}>
              <p style={styles.emptyText}>No roles configured.</p>
            </div>
          )}
          {!loading && roles.length > 0 && (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Role</th>
                    <th style={styles.th}>Description</th>
                    <th style={styles.th}>Permissions</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map(r => (
                    <tr key={r.id} style={styles.row}>
                      <td style={styles.td}>
                        <span style={styles.roleName}>{r.name}</span>
                      </td>
                      <td style={styles.td}>{r.description || '—'}</td>
                      <td style={styles.td}>
                        <div style={styles.permissionBadges}>
                          {r.permissions && r.permissions.length > 0
                            ? r.permissions.map(rp => (
                                <span key={rp.permission.id} style={styles.permBadge}>
                                  {rp.permission.name}
                                </span>
                              ))
                            : <span style={styles.noneText}>No permissions</span>
                          }
                        </div>
                      </td>
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
  row: { borderBottom: '1px solid #f3f4f6' },
  td: {
    padding: '0.875rem 1rem',
    color: '#111827',
    verticalAlign: 'top',
  },
  roleName: {
    fontWeight: 600,
    color: '#1e293b',
    textTransform: 'capitalize',
  },
  permissionBadges: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.375rem',
  },
  permBadge: {
    display: 'inline-block',
    padding: '0.2rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: 500,
    background: '#f0f9ff',
    color: '#0369a1',
    border: '1px solid #bae6fd',
  },
  noneText: {
    color: '#9ca3af',
    fontSize: '0.85rem',
  },
}
