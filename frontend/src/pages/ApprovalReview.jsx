import NotificationBell from '../components/NotificationBell'
import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'

export default function ApprovalReview() {
  const { workflowId } = useParams()
  const navigate = useNavigate()
  const [workflow, setWorkflow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) { navigate('/login'); return }

    fetch(`/api/approvals/${workflowId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        if (res.status === 401) { navigate('/login'); return null }
        if (res.status === 404) { setError('Workflow not found.'); return null }
        return res.json()
      })
      .then(data => { if (data) setWorkflow(data) })
      .catch(() => setError('Failed to load workflow.'))
      .finally(() => setLoading(false))
  }, [workflowId, navigate])

  async function handleAction(action) {
    if ((action === 'rejected' || action === 'changes_requested') && !comment.trim()) {
      setSubmitError('A comment is required when rejecting or requesting changes.')
      return
    }
    setSubmitError('')
    setSubmitting(true)
    const token = localStorage.getItem('token')
    try {
      const res = await fetch(`/api/approvals/${workflowId}/act`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          stepNumber: workflow.currentStep,
          action,
          comment: comment.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Action failed')
      navigate('/approvals')
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem('token')
    navigate('/login')
  }

  const doc = workflow?.document
  const meta = doc?.metadata

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
        </nav>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
          <div style={styles.headerInner}>
            <Link to="/approvals" style={styles.backLink}>← Approval Queue</Link>
            <h1 style={styles.pageTitle}>Document Review</h1>
          <NotificationBell />
          </div>
        </header>

        <div style={styles.content}>
          {loading && <p style={styles.message}>Loading…</p>}
          {error && <p style={{ ...styles.message, color: '#dc2626' }}>{error}</p>}

          {!loading && workflow && (
            <div style={styles.grid}>
              {/* Metadata card */}
              <div style={styles.card}>
                <h2 style={styles.cardTitle}>Document Details</h2>
                <dl style={styles.dl}>
                  <div style={styles.dlRow}>
                    <dt style={styles.dt}>Title</dt>
                    <dd style={styles.dd}>{meta?.title || doc?.originalFilename || '—'}</dd>
                  </div>
                  <div style={styles.dlRow}>
                    <dt style={styles.dt}>Type</dt>
                    <dd style={styles.dd}>{meta?.documentType || '—'}</dd>
                  </div>
                  <div style={styles.dlRow}>
                    <dt style={styles.dt}>Submitted By</dt>
                    <dd style={styles.dd}>
                      {doc?.uploadedBy?.name || doc?.uploadedBy?.email || '—'}
                    </dd>
                  </div>
                  <div style={styles.dlRow}>
                    <dt style={styles.dt}>Uploaded</dt>
                    <dd style={styles.dd}>{doc ? new Date(doc.createdAt).toLocaleString() : '—'}</dd>
                  </div>
                  <div style={styles.dlRow}>
                    <dt style={styles.dt}>Queue</dt>
                    <dd style={styles.dd}>{workflow.queueName}</dd>
                  </div>
                  <div style={styles.dlRow}>
                    <dt style={styles.dt}>Step</dt>
                    <dd style={styles.dd}>{workflow.currentStep} of {workflow.totalSteps}</dd>
                  </div>
                  {meta?.pageCount && (
                    <div style={styles.dlRow}>
                      <dt style={styles.dt}>Pages</dt>
                      <dd style={styles.dd}>{meta.pageCount}</dd>
                    </div>
                  )}
                  {meta?.author && (
                    <div style={styles.dlRow}>
                      <dt style={styles.dt}>Author</dt>
                      <dd style={styles.dd}>{meta.author}</dd>
                    </div>
                  )}
                </dl>

                {doc?.formattedStoragePath || doc?.storagePath ? (
                  <a
                    href={`/api/documents/${doc.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.viewLink}
                  >
                    View Document
                  </a>
                ) : null}
              </div>

              {/* Action panel */}
              <div style={styles.card}>
                <h2 style={styles.cardTitle}>Decision</h2>
                <div style={styles.actionPanel}>
                  <label style={styles.label}>
                    Comment
                    <textarea
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                      placeholder="Add a comment (required for Reject and Request Changes)"
                      rows={5}
                      style={styles.textarea}
                      disabled={submitting}
                    />
                  </label>

                  {submitError && <p style={styles.errorMsg}>{submitError}</p>}

                  <div style={styles.buttons}>
                    <button
                      onClick={() => handleAction('approved')}
                      disabled={submitting}
                      style={{ ...styles.btn, ...styles.btnApprove }}
                    >
                      {submitting ? '…' : 'Approve'}
                    </button>
                    <button
                      onClick={() => handleAction('changes_requested')}
                      disabled={submitting}
                      style={{ ...styles.btn, ...styles.btnChanges }}
                    >
                      {submitting ? '…' : 'Request Changes'}
                    </button>
                    <button
                      onClick={() => handleAction('rejected')}
                      disabled={submitting}
                      style={{ ...styles.btn, ...styles.btnReject }}
                    >
                      {submitting ? '…' : 'Reject'}
                    </button>
                  </div>
                </div>
              </div>
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerInner: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  backLink: {
    fontSize: '0.875rem',
    color: '#2563eb',
    textDecoration: 'none',
  },
  pageTitle: {
    fontSize: '1.25rem',
    fontWeight: 600,
    color: '#111827',
  },
  content: {
    padding: '2rem',
  },
  message: {
    color: '#6b7280',
    fontSize: '1rem',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1.5rem',
  },
  card: {
    background: '#fff',
    borderRadius: '10px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  cardTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#111827',
    borderBottom: '1px solid #e5e7eb',
    paddingBottom: '0.75rem',
  },
  dl: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  dlRow: {
    display: 'flex',
    gap: '0.5rem',
  },
  dt: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    minWidth: '110px',
    paddingTop: '2px',
  },
  dd: {
    fontSize: '0.9rem',
    color: '#111827',
  },
  viewLink: {
    display: 'inline-block',
    marginTop: '0.5rem',
    padding: '0.5rem 1rem',
    background: '#f1f5f9',
    borderRadius: '6px',
    color: '#2563eb',
    fontSize: '0.875rem',
    fontWeight: 500,
    textDecoration: 'none',
    alignSelf: 'flex-start',
  },
  actionPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: '#374151',
  },
  textarea: {
    padding: '0.625rem 0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '0.9rem',
    resize: 'vertical',
    outline: 'none',
    fontFamily: 'inherit',
  },
  errorMsg: {
    color: '#dc2626',
    fontSize: '0.875rem',
  },
  buttons: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
  },
  btn: {
    padding: '0.625rem 1.25rem',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.9rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnApprove: {
    background: '#16a34a',
    color: '#fff',
  },
  btnChanges: {
    background: '#d97706',
    color: '#fff',
  },
  btnReject: {
    background: '#dc2626',
    color: '#fff',
  },
}
