import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import NotificationBell from '../components/NotificationBell'

function getUserRole(token) {
  try {
    return JSON.parse(atob(token.split('.')[1])).role
  } catch {
    return null
  }
}

const EVENT_TYPE_LABELS = {
  'document.submitted': 'Document Submitted',
  'document.approved': 'Document Approved',
  'document.rejected': 'Document Rejected',
  'document.assigned': 'Document Assigned',
  'document.escalated': 'Document Escalated',
}

const EVENT_TYPE_DESCRIPTIONS = {
  'document.submitted': 'When a document is submitted for your review',
  'document.approved': 'When your submitted document is approved',
  'document.rejected': 'When your submitted document is rejected',
  'document.assigned': 'When a document is assigned to you',
  'document.escalated': 'When a document is escalated to you',
}

export default function NotificationSettings() {
  const navigate = useNavigate()
  const token = localStorage.getItem('token')
  const role = token ? getUserRole(token) : null

  const [prefs, setPrefs] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  function handleLogout() {
    localStorage.removeItem('token')
    navigate('/login')
  }

  useEffect(() => {
    if (!token) {
      navigate('/login')
      return
    }
    fetch('/api/notifications/preferences', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setPrefs(data)
        } else {
          setError('Failed to load preferences.')
        }
      })
      .catch(() => setError('Failed to load preferences.'))
      .finally(() => setLoading(false))
  }, [token, navigate])

  function handleToggle(eventType, channel) {
    // Admins cannot opt out of document.escalated
    if (eventType === 'document.escalated' && role === 'admin') return
    setPrefs(prev =>
      prev.map(p =>
        p.eventType === eventType ? { ...p, [channel]: !p[channel] } : p,
      ),
    )
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setToast('')
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(prefs.map(({ eventType, emailEnabled, inAppEnabled }) => ({
          eventType,
          emailEnabled,
          inAppEnabled,
        }))),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to save preferences.')
      } else {
        setPrefs(data)
        setToast('Preferences saved.')
        setTimeout(() => setToast(''), 3000)
      }
    } catch {
      setError('Failed to save preferences.')
    } finally {
      setSaving(false)
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
          <Link to="/settings/notifications" style={{ ...styles.navItem, ...styles.navItemActive }}>
            Notification Settings
          </Link>
          {role === 'admin' && (
            <>
              <Link to="/admin/routing-rules" style={styles.navItem}>Routing Rules</Link>
              <Link to="/admin/users" style={styles.navItem}>Manage Users</Link>
              <Link to="/admin/roles" style={styles.navItem}>Manage Roles</Link>
              <Link to="/admin/settings" style={styles.navItem}>Admin Settings</Link>
            </>
          )}
        </nav>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.pageTitle}>Notification Settings</h1>
          <NotificationBell />
        </header>

        <div style={styles.content}>
          {error && <div style={styles.errorBanner}>{error}</div>}
          {toast && <div style={styles.toastBanner}>{toast}</div>}

          <div style={styles.card}>
            <p style={styles.description}>
              Control which notifications you receive for document lifecycle events.
              {role === 'admin' && (
                <span style={styles.adminNote}>
                  {' '}Admin users always receive <strong>Document Escalated</strong> notifications.
                </span>
              )}
            </p>

            {loading ? (
              <p style={styles.loadingText}>Loading preferences…</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, textAlign: 'left' }}>Event</th>
                    <th style={styles.th}>Email</th>
                    <th style={styles.th}>In-App</th>
                  </tr>
                </thead>
                <tbody>
                  {prefs.map(pref => {
                    const isAdminEscalation = pref.eventType === 'document.escalated' && role === 'admin'
                    return (
                      <tr key={pref.eventType} style={styles.tr}>
                        <td style={styles.tdLabel}>
                          <span style={styles.eventLabel}>{EVENT_TYPE_LABELS[pref.eventType] || pref.eventType}</span>
                          <span style={styles.eventDesc}>{EVENT_TYPE_DESCRIPTIONS[pref.eventType]}</span>
                        </td>
                        <td style={styles.tdToggle}>
                          <Toggle
                            checked={isAdminEscalation ? true : pref.emailEnabled}
                            disabled={isAdminEscalation}
                            onChange={() => handleToggle(pref.eventType, 'emailEnabled')}
                          />
                        </td>
                        <td style={styles.tdToggle}>
                          <Toggle
                            checked={isAdminEscalation ? true : pref.inAppEnabled}
                            disabled={isAdminEscalation}
                            onChange={() => handleToggle(pref.eventType, 'inAppEnabled')}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            <div style={styles.saveRow}>
              <button
                onClick={handleSave}
                disabled={saving || loading}
                style={{ ...styles.saveBtn, opacity: saving || loading ? 0.6 : 1 }}
              >
                {saving ? 'Saving…' : 'Save preferences'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function Toggle({ checked, disabled, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={disabled ? undefined : onChange}
      style={{
        ...toggleStyles.track,
        background: checked ? '#3b82f6' : '#d1d5db',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span
        style={{
          ...toggleStyles.thumb,
          transform: checked ? 'translateX(18px)' : 'translateX(2px)',
        }}
      />
    </button>
  )
}

const toggleStyles = {
  track: {
    display: 'inline-flex',
    alignItems: 'center',
    width: '42px',
    height: '24px',
    borderRadius: '12px',
    border: 'none',
    padding: 0,
    transition: 'background 0.2s',
    position: 'relative',
  },
  thumb: {
    position: 'absolute',
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'transform 0.2s',
  },
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
  card: {
    background: '#fff',
    borderRadius: '10px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    padding: '1.5rem 2rem',
  },
  description: { color: '#6b7280', marginBottom: '1.5rem', fontSize: '0.95rem' },
  adminNote: { color: '#374151' },
  loadingText: { color: '#6b7280', padding: '1rem 0' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    padding: '0.75rem 1rem',
    fontSize: '0.8rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#6b7280',
    borderBottom: '1px solid #e5e7eb',
  },
  tr: { borderBottom: '1px solid #f3f4f6' },
  tdLabel: { padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  tdToggle: { padding: '1rem', textAlign: 'center', verticalAlign: 'middle' },
  eventLabel: { fontWeight: 500, color: '#111827', fontSize: '0.9rem' },
  eventDesc: { color: '#9ca3af', fontSize: '0.8rem' },
  saveRow: { marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' },
  saveBtn: {
    padding: '0.625rem 1.5rem',
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontWeight: 600,
    fontSize: '0.9rem',
    cursor: 'pointer',
  },
  errorBanner: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#dc2626',
    borderRadius: '6px',
    padding: '0.75rem 1rem',
    fontSize: '0.9rem',
  },
  toastBanner: {
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    color: '#16a34a',
    borderRadius: '6px',
    padding: '0.75rem 1rem',
    fontSize: '0.9rem',
  },
}
