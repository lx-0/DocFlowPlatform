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

function BulkActionModal({ selectedCount, onConfirm, onCancel }) {
  const [action, setAction] = useState('approved')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!comment.trim()) {
      setError('A comment is required for bulk actions.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onConfirm(action, comment.trim())
    } catch (err) {
      setError(err.message || 'Bulk action failed.')
      setSubmitting(false)
    }
  }

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h2 style={styles.modalTitle}>Bulk Action — {selectedCount} document{selectedCount !== 1 ? 's' : ''}</h2>
        <form onSubmit={handleSubmit}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Action</label>
            <select
              value={action}
              onChange={e => setAction(e.target.value)}
              style={styles.select}
              disabled={submitting}
            >
              <option value="approved">Approve</option>
              <option value="rejected">Reject</option>
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Comment <span style={{ color: '#dc2626' }}>*</span></label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Required: applies to all selected documents"
              style={styles.textarea}
              rows={3}
              disabled={submitting}
            />
            <p style={styles.helpText}>This comment will be applied to all selected documents.</p>
          </div>
          {error && <p style={styles.errorText}>{error}</p>}
          <div style={styles.modalActions}>
            <button type="button" onClick={onCancel} style={styles.cancelBtn} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              style={{ ...styles.confirmBtn, ...(action === 'rejected' ? styles.rejectBtn : {}) }}
              disabled={submitting || !comment.trim()}
            >
              {submitting ? 'Processing…' : `${action === 'approved' ? 'Approve' : 'Reject'} ${selectedCount} document${selectedCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function BulkResultBanner({ results, onDismiss }) {
  const succeeded = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length
  const failures = results.filter(r => !r.success)

  return (
    <div style={{ ...styles.banner, ...(failed > 0 ? styles.bannerPartial : styles.bannerSuccess) }}>
      <div style={styles.bannerHeader}>
        <span>
          {succeeded > 0 && `${succeeded} document${succeeded !== 1 ? 's' : ''} processed successfully.`}
          {failed > 0 && ` ${failed} failed.`}
        </span>
        <button onClick={onDismiss} style={styles.dismissBtn}>✕</button>
      </div>
      {failures.length > 0 && (
        <ul style={styles.failureList}>
          {failures.map(f => (
            <li key={f.workflowId} style={styles.failureItem}>{f.error}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function ApprovalQueue() {
  const navigate = useNavigate()
  const [workflows, setWorkflows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkResults, setBulkResults] = useState(null)
  const token = localStorage.getItem('token')
  const role = token ? getUserRole(token) : null

  function loadWorkflows() {
    const tok = localStorage.getItem('token')
    if (!tok) { navigate('/login'); return }
    setLoading(true)
    fetch('/api/approvals', {
      headers: { Authorization: `Bearer ${tok}` },
    })
      .then(res => {
        if (res.status === 401) { navigate('/login'); return null }
        return res.json()
      })
      .then(data => {
        if (data) {
          setWorkflows(data)
          // Clear selections that are no longer in the list
          setSelected(prev => {
            const ids = new Set(data.map(wf => wf.id))
            const next = new Set([...prev].filter(id => ids.has(id)))
            return next
          })
        }
      })
      .catch(() => setError('Failed to load approval queue.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadWorkflows() }, [navigate])

  function handleLogout() {
    localStorage.removeItem('token')
    navigate('/login')
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === workflows.length && workflows.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(workflows.map(wf => wf.id)))
    }
  }

  async function handleBulkConfirm(action, comment) {
    const tok = localStorage.getItem('token')
    const workflowIds = [...selected]
    const res = await fetch('/api/approvals/bulk-act', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tok}`,
      },
      body: JSON.stringify({ workflowIds, action, comment }),
    })
    if (res.status === 401) { navigate('/login'); return }
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Bulk action failed')
    setShowBulkModal(false)
    setSelected(new Set())
    setBulkResults(data.results)
    loadWorkflows()
  }

  const allSelected = workflows.length > 0 && selected.size === workflows.length
  const someSelected = selected.size > 0 && !allSelected
  const pendingOnly = workflows.filter(wf => wf.status === 'pending')

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
          <NotificationBell />
        </header>
        <div style={styles.content}>
          {bulkResults && (
            <BulkResultBanner results={bulkResults} onDismiss={() => setBulkResults(null)} />
          )}
          {loading && <p style={styles.message}>Loading…</p>}
          {error && <p style={{ ...styles.message, color: '#dc2626' }}>{error}</p>}
          {!loading && !error && workflows.length === 0 && (
            <div style={styles.empty}>
              <p style={styles.emptyText}>No documents awaiting your approval.</p>
            </div>
          )}
          {!loading && workflows.length > 0 && (
            <>
              {selected.size > 0 && (
                <div style={styles.bulkToolbar}>
                  <span style={styles.bulkCount}>{selected.size} selected</span>
                  <button
                    style={styles.bulkActionBtn}
                    onClick={() => setShowBulkModal(true)}
                    disabled={selected.size > 50}
                  >
                    Bulk Action
                  </button>
                  {selected.size > 50 && (
                    <span style={styles.bulkLimitWarning}>Maximum 50 documents per bulk operation</span>
                  )}
                  <button style={styles.clearSelectionBtn} onClick={() => setSelected(new Set())}>
                    Clear selection
                  </button>
                </div>
              )}
              <div style={styles.tableWrapper}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={{ ...styles.th, width: '40px' }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = someSelected }}
                          onChange={toggleSelectAll}
                          style={styles.checkbox}
                          aria-label="Select all"
                        />
                      </th>
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
                        style={{ ...styles.row, ...(selected.has(wf.id) ? styles.rowSelected : {}) }}
                      >
                        <td style={styles.td} onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(wf.id)}
                            onChange={() => toggleSelect(wf.id)}
                            style={styles.checkbox}
                            aria-label={`Select ${wf.document?.metadata?.title || wf.document?.originalFilename || wf.id}`}
                          />
                        </td>
                        <td
                          style={{ ...styles.td, cursor: 'pointer' }}
                          onClick={() => navigate(`/approvals/${wf.id}`)}
                        >
                          {wf.document?.metadata?.title || wf.document?.originalFilename || '—'}
                        </td>
                        <td style={styles.td} onClick={() => navigate(`/approvals/${wf.id}`)}>
                          {wf.document?.metadata?.documentType || '—'}
                        </td>
                        <td style={styles.td} onClick={() => navigate(`/approvals/${wf.id}`)}>
                          {wf.document?.uploadedBy?.name || wf.document?.uploadedBy?.email || '—'}
                        </td>
                        <td style={styles.td} onClick={() => navigate(`/approvals/${wf.id}`)}>
                          {new Date(wf.createdAt).toLocaleDateString()}
                        </td>
                        <td style={styles.td} onClick={() => navigate(`/approvals/${wf.id}`)}>
                          <StatusChip status={wf.status} />
                        </td>
                        <td style={styles.td} onClick={() => navigate(`/approvals/${wf.id}`)}>
                          {wf.queueName}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </main>

      {showBulkModal && (
        <BulkActionModal
          selectedCount={selected.size}
          onConfirm={handleBulkConfirm}
          onCancel={() => setShowBulkModal(false)}
        />
      )}
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
  bulkToolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 1rem',
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: '8px',
    flexWrap: 'wrap',
  },
  bulkCount: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#1d4ed8',
  },
  bulkActionBtn: {
    padding: '0.4rem 0.875rem',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: 500,
  },
  bulkLimitWarning: {
    fontSize: '0.8rem',
    color: '#dc2626',
  },
  clearSelectionBtn: {
    padding: '0.4rem 0.75rem',
    background: 'transparent',
    color: '#6b7280',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.8rem',
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
    borderBottom: '1px solid #f3f4f6',
  },
  rowSelected: {
    background: '#eff6ff',
  },
  td: {
    padding: '0.875rem 1rem',
    color: '#111827',
    verticalAlign: 'middle',
  },
  checkbox: {
    cursor: 'pointer',
    width: '16px',
    height: '16px',
  },
  chip: {
    display: 'inline-block',
    padding: '0.25rem 0.625rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: 600,
  },
  // Modal styles
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#fff',
    borderRadius: '12px',
    padding: '2rem',
    width: '100%',
    maxWidth: '480px',
    boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
  },
  modalTitle: {
    fontSize: '1.1rem',
    fontWeight: 700,
    color: '#111827',
    marginBottom: '1.25rem',
  },
  formGroup: {
    marginBottom: '1rem',
  },
  label: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: '#374151',
    marginBottom: '0.375rem',
  },
  select: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.9rem',
    color: '#111827',
    background: '#fff',
    cursor: 'pointer',
  },
  textarea: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.9rem',
    color: '#111827',
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  helpText: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginTop: '0.25rem',
  },
  errorText: {
    fontSize: '0.875rem',
    color: '#dc2626',
    marginBottom: '0.75rem',
  },
  modalActions: {
    display: 'flex',
    gap: '0.75rem',
    justifyContent: 'flex-end',
    marginTop: '1.25rem',
  },
  cancelBtn: {
    padding: '0.5rem 1rem',
    background: 'transparent',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    color: '#374151',
  },
  confirmBtn: {
    padding: '0.5rem 1rem',
    background: '#16a34a',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: 500,
  },
  rejectBtn: {
    background: '#dc2626',
  },
  // Result banner styles
  banner: {
    borderRadius: '8px',
    padding: '0.875rem 1rem',
    fontSize: '0.875rem',
  },
  bannerSuccess: {
    background: '#dcfce7',
    border: '1px solid #86efac',
    color: '#166534',
  },
  bannerPartial: {
    background: '#fef9c3',
    border: '1px solid #fde047',
    color: '#854d0e',
  },
  bannerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dismissBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.9rem',
    color: 'inherit',
    padding: '0 0.25rem',
  },
  failureList: {
    marginTop: '0.5rem',
    paddingLeft: '1.25rem',
    fontSize: '0.8rem',
  },
  failureItem: {
    marginBottom: '0.2rem',
  },
}
