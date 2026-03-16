import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'

function getUserRole(token) {
  try {
    return JSON.parse(atob(token.split('.')[1])).role
  } catch {
    return null
  }
}

export default function AdminUsers() {
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)
  const token = localStorage.getItem('token')
  const role = token ? getUserRole(token) : null

  useEffect(() => {
    const t = localStorage.getItem('token')
    if (!t) { navigate('/login'); return }
    if (getUserRole(t) !== 'admin') { navigate('/dashboard'); return }

    Promise.all([
      fetch('/api/admin/users', { headers: { Authorization: `Bearer ${t}` } }),
      fetch('/api/admin/roles', { headers: { Authorization: `Bearer ${t}` } }),
    ])
      .then(async ([usersRes, rolesRes]) => {
        if (usersRes.status === 401 || rolesRes.status === 401) { navigate('/login'); return }
        if (usersRes.status === 403 || rolesRes.status === 403) { navigate('/dashboard'); return }
        const [usersData, rolesData] = await Promise.all([usersRes.json(), rolesRes.json()])
        setUsers(usersData)
        setRoles(rolesData)
      })
      .catch(() => setError('Failed to load users.'))
      .finally(() => setLoading(false))
  }, [navigate])

  async function handleRoleChange(userId, roleId) {
    const t = localStorage.getItem('token')
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        showToast(err.error || 'Failed to update role.', 'error')
        return
      }
      const updated = await res.json()
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, roleId: updated.roleId, role: updated.role } : u))
      showToast('Role updated successfully.', 'success')
    } catch {
      showToast('Failed to update role.', 'error')
    }
  }

  function showToast(message, type) {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

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
          <a href="#" style={styles.navItem}>Settings</a>
          {role === 'admin' && (
            <>
              <Link to="/admin/routing-rules" style={styles.navItem}>Routing Rules</Link>
              <Link to="/admin/users" style={{ ...styles.navItem, ...styles.navItemActive }}>Manage Users</Link>
              <Link to="/admin/roles" style={styles.navItem}>Manage Roles</Link>
            </>
          )}
        </nav>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.pageTitle}>User Management</h1>
        </header>
        <div style={styles.content}>
          {loading && <p style={styles.message}>Loading…</p>}
          {error && <p style={{ ...styles.message, color: '#dc2626' }}>{error}</p>}
          {!loading && !error && users.length === 0 && (
            <div style={styles.empty}>
              <p style={styles.emptyText}>No users found.</p>
            </div>
          )}
          {!loading && users.length > 0 && (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Email</th>
                    <th style={styles.th}>Current Role</th>
                    <th style={styles.th}>Joined</th>
                    <th style={styles.th}>Assign Role</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(user => (
                    <tr key={user.id} style={styles.row}>
                      <td style={styles.td}>{user.email}</td>
                      <td style={styles.td}>
                        <span style={styles.roleChip}>{user.role || '—'}</span>
                      </td>
                      <td style={styles.td}>{new Date(user.createdAt).toLocaleDateString()}</td>
                      <td style={styles.td}>
                        <select
                          style={styles.select}
                          value={user.roleId || ''}
                          onChange={e => handleRoleChange(user.id, e.target.value)}
                        >
                          <option value="" disabled>Select role…</option>
                          {roles.map(r => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {toast && (
        <div style={{ ...styles.toast, ...(toast.type === 'error' ? styles.toastError : styles.toastSuccess) }}>
          {toast.message}
        </div>
      )}
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
    verticalAlign: 'middle',
  },
  roleChip: {
    display: 'inline-block',
    padding: '0.25rem 0.625rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: 600,
    background: '#e0e7ff',
    color: '#3730a3',
  },
  select: {
    padding: '0.375rem 0.625rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.875rem',
    color: '#111827',
    background: '#fff',
    cursor: 'pointer',
  },
  toast: {
    position: 'fixed',
    bottom: '1.5rem',
    right: '1.5rem',
    padding: '0.75rem 1.25rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: 500,
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    zIndex: 100,
  },
  toastSuccess: { background: '#dcfce7', color: '#166534' },
  toastError: { background: '#fee2e2', color: '#991b1b' },
}
