import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

const POLL_INTERVAL_MS = 60_000

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const TYPE_ICON = {
  'document.submitted': '📄',
  'document.approved': '✅',
  'document.rejected': '❌',
  'document.assigned': '📋',
  'document.escalated': '⚠️',
}

export default function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifications, setNotifications] = useState([])
  const [open, setOpen] = useState(false)
  const panelRef = useRef(null)
  const navigate = useNavigate()

  const token = localStorage.getItem('token')

  const fetchUnreadCount = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/notifications/unread-count', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setUnreadCount(data.count)
      }
    } catch {
      // ignore
    }
  }, [token])

  const fetchNotifications = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/notifications', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setNotifications(await res.json())
      }
    } catch {
      // ignore
    }
  }, [token])

  // Initial load + polling for unread count
  useEffect(() => {
    fetchUnreadCount()
    const interval = setInterval(fetchUnreadCount, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchUnreadCount])

  // Load full list when panel opens
  useEffect(() => {
    if (open) {
      fetchNotifications()
    }
  }, [open, fetchNotifications])

  // Close panel on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function markRead(id) {
    try {
      await fetch(`/api/notifications/${id}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      })
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, readAt: new Date().toISOString() } : n)
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch {
      // ignore
    }
  }

  async function markAllRead() {
    try {
      await fetch('/api/notifications/read-all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const now = new Date().toISOString()
      setNotifications(prev => prev.map(n => ({ ...n, readAt: n.readAt ?? now })))
      setUnreadCount(0)
    } catch {
      // ignore
    }
  }

  function handleNotificationClick(n) {
    if (!n.readAt) markRead(n.id)
    if (n.linkUrl) {
      setOpen(false)
      navigate(n.linkUrl)
    }
  }

  return (
    <div style={styles.wrapper} ref={panelRef}>
      <button
        style={styles.bell}
        onClick={() => setOpen(o => !o)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        title="Notifications"
      >
        <span style={styles.bellIcon}>🔔</span>
        {unreadCount > 0 && (
          <span style={styles.badge}>{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelTitle}>Notifications</span>
            {unreadCount > 0 && (
              <button style={styles.markAllBtn} onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>
          <div style={styles.list}>
            {notifications.length === 0 ? (
              <div style={styles.empty}>No notifications</div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  style={{ ...styles.item, ...(n.readAt ? {} : styles.itemUnread) }}
                  onClick={() => handleNotificationClick(n)}
                >
                  <span style={styles.typeIcon}>{TYPE_ICON[n.type] ?? '🔔'}</span>
                  <div style={styles.itemBody}>
                    <div style={styles.itemTitle}>{n.title}</div>
                    <div style={styles.itemDesc}>{n.body}</div>
                    <div style={styles.itemTime}>{timeAgo(n.createdAt)}</div>
                  </div>
                  {!n.readAt && <span style={styles.dot} aria-hidden="true" />}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  wrapper: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
  },
  bell: {
    position: 'relative',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '0.375rem',
    borderRadius: '6px',
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellIcon: {
    fontSize: '1.25rem',
    userSelect: 'none',
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    background: '#ef4444',
    color: '#fff',
    fontSize: '0.65rem',
    fontWeight: 700,
    borderRadius: '9999px',
    minWidth: '16px',
    height: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 3px',
    lineHeight: 1,
  },
  panel: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: 0,
    width: '340px',
    maxHeight: '420px',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.75rem 1rem',
    borderBottom: '1px solid #f3f4f6',
    flexShrink: 0,
  },
  panelTitle: {
    fontWeight: 600,
    fontSize: '0.9rem',
    color: '#111827',
  },
  markAllBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#3b82f6',
    fontSize: '0.8rem',
    fontWeight: 500,
    padding: 0,
  },
  list: {
    overflowY: 'auto',
    flex: 1,
  },
  empty: {
    padding: '2rem',
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: '0.875rem',
  },
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.625rem',
    padding: '0.75rem 1rem',
    cursor: 'pointer',
    borderBottom: '1px solid #f9fafb',
    background: '#fff',
    transition: 'background 0.1s',
  },
  itemUnread: {
    background: '#eff6ff',
  },
  typeIcon: {
    fontSize: '1.1rem',
    flexShrink: 0,
    marginTop: '1px',
  },
  itemBody: {
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    fontWeight: 600,
    fontSize: '0.825rem',
    color: '#111827',
    marginBottom: '2px',
  },
  itemDesc: {
    fontSize: '0.775rem',
    color: '#6b7280',
    marginBottom: '3px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemTime: {
    fontSize: '0.7rem',
    color: '#9ca3af',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#3b82f6',
    flexShrink: 0,
    marginTop: '4px',
  },
}
