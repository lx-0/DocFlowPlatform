import NotificationBell from '../components/NotificationBell'
import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'

const ROUTING_STATUS_COLORS = {
  unrouted:    { bg: '#f3f4f6', color: '#6b7280', label: 'Unrouted' },
  queued:      { bg: '#eff6ff', color: '#2563eb', label: 'Queued' },
  in_approval: { bg: '#fef9c3', color: '#b45309', label: 'In Approval' },
  approved:    { bg: '#f0fdf4', color: '#16a34a', label: 'Approved' },
  rejected:    { bg: '#fef2f2', color: '#dc2626', label: 'Rejected' },
}

const ACTION_COLORS = {
  approved:           { bg: '#f0fdf4', color: '#16a34a', label: 'Approved' },
  rejected:           { bg: '#fef2f2', color: '#dc2626', label: 'Rejected' },
  changes_requested:  { bg: '#fff7ed', color: '#c2410c', label: 'Changes Requested' },
}

function StatusChip({ status, map }) {
  const cfg = map[status] || { bg: '#f3f4f6', color: '#6b7280', label: status }
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

export default function DocumentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const token = localStorage.getItem('token')
  const role = token ? getUserRole(token) : null
  const [doc, setDoc] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { navigate('/login'); return }

    fetch(`/api/documents/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        if (res.status === 401) { navigate('/login'); return null }
        if (res.status === 404) { setError('Document not found.'); return null }
        return res.json()
      })
      .then(data => { if (data) setDoc(data) })
      .catch(() => setError('Failed to load document.'))
      .finally(() => setLoading(false))
  }, [id, navigate, token])

  function handleLogout() {
    localStorage.removeItem('token')
    navigate('/login')
  }

  const workflow = doc?.approvalWorkflow
  const finalStep = workflow?.steps?.find(s => s.action === 'rejected' || s.action === 'changes_requested')
  const changesStep = workflow?.status === 'changes_requested'
    ? workflow.steps.filter(s => s.action === 'changes_requested').slice(-1)[0]
    : null

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
          <div style={styles.headerInner}>
            <Link to="/documents" style={styles.backLink}>← My Documents</Link>
            <h1 style={styles.pageTitle}>{doc?.originalFilename || 'Document Detail'}</h1>
          <NotificationBell />
          </div>
        </header>

        <div style={styles.content}>
          {loading && <p style={styles.message}>Loading…</p>}
          {error && <p style={{ ...styles.message, color: '#dc2626' }}>{error}</p>}

          {!loading && doc && (
            <>
              {/* Document info card */}
              <div style={styles.card}>
                <h2 style={styles.cardTitle}>Document Details</h2>
                <dl style={styles.dl}>
                  <div style={styles.dlRow}>
                    <dt style={styles.dt}>Filename</dt>
                    <dd style={styles.dd}>{doc.originalFilename}</dd>
                  </div>
                  <div style={styles.dlRow}>
                    <dt style={styles.dt}>Type</dt>
                    <dd style={styles.dd}>{doc.mimeType === 'application/pdf' ? 'PDF' : 'DOCX'}</dd>
                  </div>
                  <div style={styles.dlRow}>
                    <dt style={styles.dt}>Size</dt>
                    <dd style={styles.dd}>{(doc.sizeBytes / 1024).toFixed(1)} KB</dd>
                  </div>
                  <div style={styles.dlRow}>
                    <dt style={styles.dt}>Pipeline Status</dt>
                    <dd style={styles.dd}>{doc.status}</dd>
                  </div>
                  <div style={styles.dlRow}>
                    <dt style={styles.dt}>Approval Status</dt>
                    <dd style={styles.dd}>
                      <StatusChip status={doc.routingStatus || 'unrouted'} map={ROUTING_STATUS_COLORS} />
                    </dd>
                  </div>
                  {doc.routingQueueId && (
                    <div style={styles.dlRow}>
                      <dt style={styles.dt}>Queue</dt>
                      <dd style={styles.dd}>{doc.routingQueueId}</dd>
                    </div>
                  )}
                  <div style={styles.dlRow}>
                    <dt style={styles.dt}>Uploaded</dt>
                    <dd style={styles.dd}>{new Date(doc.createdAt).toLocaleString()}</dd>
                  </div>
                </dl>
              </div>

              {/* Changes requested banner */}
              {workflow?.status === 'changes_requested' && changesStep && (
                <div style={styles.changesAlert}>
                  <div style={styles.changesTitle}>Changes Requested</div>
                  <p style={styles.changesBody}>{changesStep.comment || 'The approver has requested changes to this document.'}</p>
                  <button disabled style={styles.resubmitBtn}>Re-submit (coming soon)</button>
                </div>
              )}

              {/* Rejected banner */}
              {workflow?.status === 'rejected' && finalStep && (
                <div style={styles.rejectedAlert}>
                  <div style={styles.rejectedTitle}>Document Rejected</div>
                  {finalStep.comment && <p style={styles.changesBody}>{finalStep.comment}</p>}
                </div>
              )}

              {/* Approval Timeline */}
              {workflow && (
                <div style={styles.card}>
                  <h2 style={styles.cardTitle}>
                    Approval Timeline
                    <span style={{ marginLeft: '0.75rem', fontWeight: 400, fontSize: '0.85rem', color: '#6b7280' }}>
                      {workflow.queueName} · Step {workflow.currentStep} of {workflow.totalSteps}
                    </span>
                  </h2>

                  {workflow.steps.length === 0 ? (
                    <p style={styles.message}>No steps recorded yet.</p>
                  ) : (
                    <div style={styles.timeline}>
                      {workflow.steps.map((step, idx) => (
                        <div key={step.id} style={styles.timelineItem}>
                          <div style={styles.timelineLeft}>
                            <div style={{
                              ...styles.stepDot,
                              background: step.action
                                ? ACTION_COLORS[step.action]?.bg || '#f3f4f6'
                                : '#e5e7eb',
                              borderColor: step.action
                                ? ACTION_COLORS[step.action]?.color || '#9ca3af'
                                : '#d1d5db',
                            }} />
                            {idx < workflow.steps.length - 1 && <div style={styles.timelineLine} />}
                          </div>
                          <div style={styles.timelineRight}>
                            <div style={styles.stepHeader}>
                              <span style={styles.stepNumber}>Step {step.stepNumber}</span>
                              {step.action ? (
                                <StatusChip status={step.action} map={ACTION_COLORS} />
                              ) : (
                                <span style={{ ...styles.chip, background: '#f3f4f6', color: '#6b7280' }}>Pending</span>
                              )}
                              {step.actedAt && (
                                <span style={styles.stepTime}>{new Date(step.actedAt).toLocaleString()}</span>
                              )}
                            </div>
                            {step.comment && (
                              <p style={styles.stepComment}>{step.comment}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
  headerInner: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  backLink: { fontSize: '0.875rem', color: '#2563eb', textDecoration: 'none' },
  pageTitle: { fontSize: '1.25rem', fontWeight: 600, color: '#111827' },
  content: { padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' },
  message: { color: '#6b7280', fontSize: '1rem' },
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
    display: 'flex',
    alignItems: 'center',
  },
  dl: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  dlRow: { display: 'flex', gap: '0.5rem' },
  dt: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    minWidth: '130px',
    paddingTop: '2px',
  },
  dd: { fontSize: '0.9rem', color: '#111827' },
  chip: {
    display: 'inline-block',
    padding: '0.2rem 0.6rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: 600,
  },
  changesAlert: {
    background: '#fff7ed',
    border: '1px solid #fed7aa',
    borderRadius: '10px',
    padding: '1.25rem 1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  changesTitle: { fontWeight: 700, color: '#c2410c', fontSize: '1rem' },
  changesBody: { color: '#374151', fontSize: '0.9rem', margin: 0 },
  resubmitBtn: {
    alignSelf: 'flex-start',
    padding: '0.5rem 1rem',
    background: '#e5e7eb',
    border: 'none',
    borderRadius: '6px',
    color: '#9ca3af',
    fontSize: '0.875rem',
    cursor: 'not-allowed',
  },
  rejectedAlert: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '10px',
    padding: '1.25rem 1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  rejectedTitle: { fontWeight: 700, color: '#dc2626', fontSize: '1rem' },
  timeline: { display: 'flex', flexDirection: 'column' },
  timelineItem: { display: 'flex', gap: '1rem' },
  timelineLeft: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '20px' },
  stepDot: {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    border: '2px solid',
    flexShrink: 0,
    marginTop: '3px',
  },
  timelineLine: { width: '2px', flex: 1, background: '#e5e7eb', margin: '4px 0' },
  timelineRight: {
    flex: 1,
    paddingBottom: '1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
  },
  stepHeader: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
  stepNumber: { fontSize: '0.9rem', fontWeight: 600, color: '#374151' },
  stepTime: { fontSize: '0.75rem', color: '#9ca3af', marginLeft: 'auto' },
  stepComment: {
    margin: 0,
    fontSize: '0.875rem',
    color: '#4b5563',
    background: '#f9fafb',
    borderRadius: '6px',
    padding: '0.5rem 0.75rem',
    borderLeft: '3px solid #e5e7eb',
  },
}
