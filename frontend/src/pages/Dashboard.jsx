import { useNavigate, Link } from 'react-router-dom'
import NotificationBell from '../components/NotificationBell'

const AUTH_MODE = import.meta.env.VITE_AUTH_MODE || 'local'

function getUserRole(token) {
  try {
    return JSON.parse(atob(token.split('.')[1])).role
  } catch {
    return null
  }
}

export default function Dashboard() {
  const navigate = useNavigate()
  const token = localStorage.getItem('token')
  const role = token ? getUserRole(token) : null

  async function handleLogout() {
    if (AUTH_MODE === 'sso') {
      try {
        const res = await fetch('/api/auth/sso/logout', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
        })
        const data = await res.json()
        localStorage.removeItem('token')
        // Redirect to the IdP SLO URL (or fallback to /login)
        window.location.href = data.redirectUrl || '/login'
      } catch {
        localStorage.removeItem('token')
        window.location.href = '/login'
      }
    } else {
      // Non-SSO: notify backend for audit logging, then clear local session
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
      } catch {}
      localStorage.removeItem('token')
      navigate('/login')
    }
  }

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <div style={styles.logo}>DocFlow</div>
        <nav style={styles.nav}>
          <a href="#" style={{ ...styles.navItem, ...styles.navItemActive }}>Dashboard</a>
          <Link to="/documents" style={styles.navItem}>Documents</Link>
          <a href="#" style={styles.navItem}>Workflows</a>
          <Link to="/approvals" style={styles.navItem}>Approvals</Link>
          <Link to="/settings/notifications" style={styles.navItem}>Settings</Link>
          {role === 'admin' && (
            <>
              <Link to="/admin/routing-rules" style={styles.navItem}>Routing Rules</Link>
              <Link to="/admin/users" style={styles.navItem}>Manage Users</Link>
              <Link to="/admin/roles" style={styles.navItem}>Manage Roles</Link>
            </>
          )}
        </nav>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </aside>
      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.pageTitle}>Dashboard</h1>
          <NotificationBell />
        </header>
        <div style={styles.content}>
          <div style={styles.statsRow}>
            <StatCard label="Documents" value="—" />
            <StatCard label="Pending Approvals" value="—" />
            <StatCard label="Completed" value="—" />
          </div>
          <div style={styles.placeholder}>
            <p style={styles.placeholderText}>
              Welcome to DocFlow Platform. Document workflow features are coming soon.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div style={styles.statCard}>
      <span style={styles.statValue}>{value}</span>
      <span style={styles.statLabel}>{label}</span>
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  statsRow: {
    display: 'flex',
    gap: '1rem',
  },
  statCard: {
    background: '#fff',
    borderRadius: '10px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    padding: '1.25rem 1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    minWidth: '140px',
  },
  statValue: {
    fontSize: '1.75rem',
    fontWeight: 700,
    color: '#111827',
  },
  statLabel: {
    fontSize: '0.8rem',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  placeholder: {
    background: '#fff',
    borderRadius: '10px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    padding: '3rem',
    textAlign: 'center',
  },
  placeholderText: {
    color: '#6b7280',
    fontSize: '1rem',
  },
}
