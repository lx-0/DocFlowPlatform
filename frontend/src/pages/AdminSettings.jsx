import NotificationBell from '../components/NotificationBell'
import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'

function getUserRole(token) {
  try {
    return JSON.parse(atob(token.split('.')[1])).role
  } catch {
    return null
  }
}

const EVENT_TYPE_LABELS = {
  submitted: 'Document Submitted',
  approved: 'Document Approved',
  rejected: 'Document Rejected',
  assigned: 'Document Assigned',
  escalated: 'Document Escalated',
}

const SAMPLE_DATA = {
  documentTitle: 'Sample Document',
  documentId: 'DOC-00000000-0000-0000-0000-000000000000',
  reasonRow: '<tr style="background:#f5f5f5"><td style="padding:8px;font-weight:bold">Reason:</td><td style="padding:8px">Sample rejection reason</td></tr>',
  reasonLine: 'Reason: Sample rejection reason\n',
}

function renderPreview(template, vars) {
  let out = template
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }
  return out
}

export default function AdminSettings() {
  const navigate = useNavigate()
  const token = localStorage.getItem('token')
  const role = token ? getUserRole(token) : null

  const [activeTab, setActiveTab] = useState('retention')

  // ─── Retention settings ───────────────────────────────────────────────────
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [docDays, setDocDays] = useState('')
  const [auditDays, setAuditDays] = useState('')

  // ─── Email / SMTP settings ────────────────────────────────────────────────
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('')
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPass, setSmtpPass] = useState('')
  const [smtpPassMasked, setSmtpPassMasked] = useState(false)
  const [smtpPassVisible, setSmtpPassVisible] = useState(false)
  const [smtpFromAddress, setSmtpFromAddress] = useState('')
  const [smtpFromName, setSmtpFromName] = useState('')
  const [smtpSaving, setSmtpSaving] = useState(false)
  const [smtpMsg, setSmtpMsg] = useState('')
  const [smtpError, setSmtpError] = useState('')
  const [testEmailSending, setTestEmailSending] = useState(false)
  const [testEmailMsg, setTestEmailMsg] = useState('')
  const [testEmailError, setTestEmailError] = useState('')

  // ─── Notification templates ───────────────────────────────────────────────
  const [templates, setTemplates] = useState([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null) // { eventType, subject, body }
  const [templateSaving, setTemplateSaving] = useState(false)
  const [templateMsg, setTemplateMsg] = useState('')
  const [templateError, setTemplateError] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    const t = localStorage.getItem('token')
    if (!t) { navigate('/login'); return }
    if (getUserRole(t) !== 'admin') { navigate('/dashboard'); return }
  }, [navigate])

  useEffect(() => { fetchSettings() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchSettings() {
    const t = localStorage.getItem('token')
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/settings', { headers: { Authorization: `Bearer ${t}` } })
      if (res.status === 401) { navigate('/login'); return }
      if (res.status === 403) { navigate('/dashboard'); return }
      if (!res.ok) { setError('Failed to load settings.'); return }
      const data = await res.json()
      setSettings(data)
      setDocDays(String(data.documentRetentionDays))
      setAuditDays(String(data.auditLogRetentionDays))
      setSmtpHost(data.smtpHost || '')
      setSmtpPort(data.smtpPort != null ? String(data.smtpPort) : '')
      setSmtpUser(data.smtpUser || '')
      setSmtpPassMasked(!!(data.smtpPass))
      setSmtpPass(data.smtpPass || '')
      setSmtpFromAddress(data.smtpFromAddress || '')
      setSmtpFromName(data.smtpFromName || '')
    } catch {
      setError('Failed to load settings.')
    } finally {
      setLoading(false)
    }
  }

  const fetchTemplates = useCallback(async () => {
    const t = localStorage.getItem('token')
    setTemplatesLoading(true)
    try {
      const res = await fetch('/api/admin/notification-templates', { headers: { Authorization: `Bearer ${t}` } })
      if (res.ok) setTemplates(await res.json())
    } catch {}
    finally { setTemplatesLoading(false) }
  }, [])

  useEffect(() => {
    if (activeTab === 'templates') fetchTemplates()
  }, [activeTab, fetchTemplates])

  async function handleSaveRetention(e) {
    e.preventDefault()
    const t = localStorage.getItem('token')
    setSaving(true); setSaveMsg(''); setError('')
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({
          documentRetentionDays: parseInt(docDays, 10),
          auditLogRetentionDays: parseInt(auditDays, 10),
        }),
      })
      if (res.status === 401) { navigate('/login'); return }
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error || 'Failed to save.'); return }
      const data = await res.json()
      setSettings(data)
      setSaveMsg('Settings saved.')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch { setError('Failed to save settings.') }
    finally { setSaving(false) }
  }

  async function handleSaveSmtp(e) {
    e.preventDefault()
    const t = localStorage.getItem('token')
    setSmtpSaving(true); setSmtpMsg(''); setSmtpError('')
    const body = { smtpHost, smtpPort: smtpPort ? parseInt(smtpPort, 10) : undefined, smtpUser, smtpFromAddress, smtpFromName }
    // Only send smtpPass if user typed a new one (not the masked placeholder)
    if (!smtpPassMasked || smtpPass !== '*****') body.smtpPass = smtpPass
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify(body),
      })
      if (res.status === 401) { navigate('/login'); return }
      if (!res.ok) { const b = await res.json().catch(() => ({})); setSmtpError(b.error || 'Failed to save.'); return }
      const data = await res.json()
      setSettings(data)
      setSmtpPassMasked(!!(data.smtpPass))
      setSmtpPass(data.smtpPass || '')
      setSmtpMsg('SMTP settings saved.')
      setTimeout(() => setSmtpMsg(''), 3000)
    } catch { setSmtpError('Failed to save SMTP settings.') }
    finally { setSmtpSaving(false) }
  }

  async function handleTestEmail() {
    const t = localStorage.getItem('token')
    setTestEmailSending(true); setTestEmailMsg(''); setTestEmailError('')
    try {
      const res = await fetch('/api/admin/settings/test-email', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      })
      if (!res.ok) { const b = await res.json().catch(() => ({})); setTestEmailError(b.error || 'Test email failed.'); return }
      const data = await res.json()
      setTestEmailMsg(`Test email sent to ${data.sentTo}`)
      setTimeout(() => setTestEmailMsg(''), 5000)
    } catch { setTestEmailError('Failed to send test email.') }
    finally { setTestEmailSending(false) }
  }

  function openEditTemplate(tpl) {
    setEditingTemplate({ eventType: tpl.eventType, subject: tpl.subject, body: tpl.body || '' })
    setTemplateMsg(''); setTemplateError(''); setShowPreview(false)
  }

  function handlePreview() {
    if (!editingTemplate) return
    setPreviewHtml(renderPreview(editingTemplate.body, SAMPLE_DATA))
    setShowPreview(true)
  }

  async function handleSaveTemplate(e) {
    e.preventDefault()
    if (!editingTemplate) return
    const t = localStorage.getItem('token')
    setTemplateSaving(true); setTemplateMsg(''); setTemplateError('')
    try {
      const res = await fetch(`/api/admin/notification-templates/${editingTemplate.eventType}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ subject: editingTemplate.subject, body: editingTemplate.body }),
      })
      if (!res.ok) { const b = await res.json().catch(() => ({})); setTemplateError(b.error || 'Failed to save template.'); return }
      setTemplateMsg('Template saved.')
      setTimeout(() => setTemplateMsg(''), 3000)
      setEditingTemplate(null)
      fetchTemplates()
    } catch { setTemplateError('Failed to save template.') }
    finally { setTemplateSaving(false) }
  }

  function handleLogout() {
    localStorage.removeItem('token')
    navigate('/login')
  }

  function formatDate(iso) {
    if (!iso) return '—'
    try { return new Date(iso).toLocaleString() } catch { return iso }
  }

  const tabs = [
    { id: 'retention', label: 'Retention' },
    { id: 'email', label: 'Email' },
    { id: 'templates', label: 'Notification Templates' },
  ]

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <div style={styles.logo}>DocFlow</div>
        <nav style={styles.nav}>
          <Link to="/dashboard" style={styles.navItem}>Dashboard</Link>
          <Link to="/documents" style={styles.navItem}>Documents</Link>
          <Link to="/approvals" style={styles.navItem}>Approvals</Link>
          {role === 'admin' && (
            <>
              <Link to="/admin/routing-rules" style={styles.navItem}>Routing Rules</Link>
              <Link to="/admin/users" style={styles.navItem}>Manage Users</Link>
              <Link to="/admin/roles" style={styles.navItem}>Manage Roles</Link>
              <Link to="/admin/audit-logs" style={styles.navItem}>Audit Logs</Link>
              <Link to="/admin/analytics" style={styles.navItem}>Analytics</Link>
              <Link to="/admin/settings" style={{ ...styles.navItem, ...styles.navItemActive }}>Settings</Link>
            </>
          )}
        </nav>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.pageTitle}>System Settings</h1>
          <NotificationBell />
        </header>

        {error && <div style={styles.errorBanner}>{error}</div>}

        {/* Tab bar */}
        <div style={styles.tabBar}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              style={{ ...styles.tab, ...(activeTab === tab.id ? styles.tabActive : {}) }}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading settings…</p>
        ) : (
          <>
            {/* ── Retention Tab ── */}
            {activeTab === 'retention' && (
              <>
                <section style={styles.card}>
                  <h2 style={styles.sectionTitle}>Retention Policy</h2>
                  <p style={styles.sectionDesc}>
                    Configure how long documents and audit logs are retained before automatic purging.
                    Set <strong>Document Retention</strong> to 0 to disable automatic document archiving.
                  </p>
                  <form onSubmit={handleSaveRetention}>
                    <div style={styles.fieldGroup}>
                      <label style={styles.label} htmlFor="docDays">Document Retention (days)</label>
                      <p style={styles.fieldHint}>
                        Approved/rejected documents older than this many days will be soft-deleted. Default: 365. Set to 0 to disable.
                      </p>
                      <input id="docDays" type="number" min="0" value={docDays}
                        onChange={(e) => setDocDays(e.target.value)} style={styles.input} required />
                    </div>
                    <div style={styles.fieldGroup}>
                      <label style={styles.label} htmlFor="auditDays">Audit Log Retention (days)</label>
                      <p style={styles.fieldHint}>
                        Audit log records older than this many days will be permanently deleted. Default: 90. Minimum: 1.
                      </p>
                      <input id="auditDays" type="number" min="1" value={auditDays}
                        onChange={(e) => setAuditDays(e.target.value)} style={styles.input} required />
                    </div>
                    <div style={styles.saveRow}>
                      <button type="submit" disabled={saving} style={styles.saveBtn}>
                        {saving ? 'Saving…' : 'Save Settings'}
                      </button>
                      {saveMsg && <span style={styles.saveMsg}>{saveMsg}</span>}
                    </div>
                  </form>
                </section>

                <section style={styles.card}>
                  <h2 style={styles.sectionTitle}>Last Purge Run</h2>
                  {settings && (
                    <table style={styles.statsTable}>
                      <tbody>
                        <tr>
                          <td style={styles.statLabel}>Last run at</td>
                          <td style={styles.statValue}>{formatDate(settings.lastPurgeAt)}</td>
                        </tr>
                        <tr>
                          <td style={styles.statLabel}>Documents archived</td>
                          <td style={styles.statValue}>{settings.lastPurgeDocumentsArchived != null ? settings.lastPurgeDocumentsArchived : '—'}</td>
                        </tr>
                        <tr>
                          <td style={styles.statLabel}>Audit logs deleted</td>
                          <td style={styles.statValue}>{settings.lastPurgeLogsDeleted != null ? settings.lastPurgeLogsDeleted : '—'}</td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                  <p style={{ ...styles.fieldHint, marginTop: '0.75rem' }}>
                    The purge job runs automatically every night at 03:00 server time.
                  </p>
                </section>
              </>
            )}

            {/* ── Email / SMTP Tab ── */}
            {activeTab === 'email' && (
              <section style={styles.card}>
                <h2 style={styles.sectionTitle}>SMTP Configuration</h2>
                <p style={styles.sectionDesc}>
                  Configure the outgoing mail server. These settings take precedence over environment variables.
                  Leave a field blank to fall back to the corresponding env var.
                </p>
                {smtpError && <div style={styles.errorBanner}>{smtpError}</div>}
                <form onSubmit={handleSaveSmtp}>
                  <div style={styles.fieldRow}>
                    <div style={{ ...styles.fieldGroup, flex: 2 }}>
                      <label style={styles.label} htmlFor="smtpHost">SMTP Host</label>
                      <input id="smtpHost" type="text" placeholder="smtp.example.com"
                        value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} style={styles.inputFull} />
                    </div>
                    <div style={{ ...styles.fieldGroup, flex: 1 }}>
                      <label style={styles.label} htmlFor="smtpPort">Port</label>
                      <input id="smtpPort" type="number" min="1" max="65535" placeholder="587"
                        value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} style={styles.inputFull} />
                    </div>
                  </div>

                  <div style={styles.fieldRow}>
                    <div style={{ ...styles.fieldGroup, flex: 1 }}>
                      <label style={styles.label} htmlFor="smtpUser">Username</label>
                      <input id="smtpUser" type="text" placeholder="user@example.com"
                        value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} style={styles.inputFull} />
                    </div>
                    <div style={{ ...styles.fieldGroup, flex: 1 }}>
                      <label style={styles.label} htmlFor="smtpPass">Password</label>
                      <div style={styles.passRow}>
                        <input
                          id="smtpPass"
                          type={smtpPassVisible ? 'text' : 'password'}
                          placeholder={smtpPassMasked ? '••••• (unchanged)' : 'password'}
                          value={smtpPass}
                          onChange={(e) => { setSmtpPass(e.target.value); setSmtpPassMasked(false) }}
                          style={{ ...styles.inputFull, flex: 1 }}
                        />
                        <button type="button" style={styles.showHideBtn}
                          onClick={() => setSmtpPassVisible((v) => !v)}>
                          {smtpPassVisible ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div style={styles.fieldRow}>
                    <div style={{ ...styles.fieldGroup, flex: 1 }}>
                      <label style={styles.label} htmlFor="smtpFrom">From Address</label>
                      <input id="smtpFrom" type="email" placeholder="noreply@example.com"
                        value={smtpFromAddress} onChange={(e) => setSmtpFromAddress(e.target.value)} style={styles.inputFull} />
                    </div>
                    <div style={{ ...styles.fieldGroup, flex: 1 }}>
                      <label style={styles.label} htmlFor="smtpFromName">From Name</label>
                      <input id="smtpFromName" type="text" placeholder="DocFlow"
                        value={smtpFromName} onChange={(e) => setSmtpFromName(e.target.value)} style={styles.inputFull} />
                    </div>
                  </div>

                  <div style={styles.saveRow}>
                    <button type="submit" disabled={smtpSaving} style={styles.saveBtn}>
                      {smtpSaving ? 'Saving…' : 'Save SMTP Settings'}
                    </button>
                    <button type="button" disabled={testEmailSending} style={styles.secondaryBtn}
                      onClick={handleTestEmail}>
                      {testEmailSending ? 'Sending…' : 'Send Test Email'}
                    </button>
                    {smtpMsg && <span style={styles.saveMsg}>{smtpMsg}</span>}
                    {testEmailMsg && <span style={styles.saveMsg}>{testEmailMsg}</span>}
                  </div>
                  {testEmailError && <div style={{ ...styles.errorBanner, marginTop: '0.75rem' }}>{testEmailError}</div>}
                </form>
              </section>
            )}

            {/* ── Templates Tab ── */}
            {activeTab === 'templates' && (
              <section style={styles.card}>
                <h2 style={styles.sectionTitle}>Notification Email Templates</h2>
                <p style={styles.sectionDesc}>
                  Customize the subject and HTML body for each notification type. Use{' '}
                  <code style={styles.code}>{'{{documentTitle}}'}</code>,{' '}
                  <code style={styles.code}>{'{{documentId}}'}</code> as template variables.
                  For rejected documents, <code style={styles.code}>{'{{reasonRow}}'}</code> inserts an HTML reason row.
                </p>
                {templateMsg && <div style={{ ...styles.saveMsg, display: 'block', marginBottom: '0.75rem' }}>{templateMsg}</div>}
                {templateError && <div style={styles.errorBanner}>{templateError}</div>}

                {editingTemplate ? (
                  /* ── Edit form ── */
                  <div>
                    <div style={styles.editHeader}>
                      <strong>{EVENT_TYPE_LABELS[editingTemplate.eventType]}</strong>
                      <button style={styles.linkBtn} onClick={() => setEditingTemplate(null)}>← Back to list</button>
                    </div>
                    <form onSubmit={handleSaveTemplate}>
                      <div style={styles.fieldGroup}>
                        <label style={styles.label}>Subject</label>
                        <input type="text" value={editingTemplate.subject}
                          onChange={(e) => setEditingTemplate((prev) => ({ ...prev, subject: e.target.value }))}
                          style={styles.inputFull} required />
                      </div>
                      <div style={styles.fieldGroup}>
                        <label style={styles.label}>Body (HTML)</label>
                        <textarea
                          rows={14}
                          value={editingTemplate.body}
                          onChange={(e) => setEditingTemplate((prev) => ({ ...prev, body: e.target.value }))}
                          style={styles.textarea}
                        />
                      </div>
                      <div style={styles.saveRow}>
                        <button type="submit" disabled={templateSaving} style={styles.saveBtn}>
                          {templateSaving ? 'Saving…' : 'Save Template'}
                        </button>
                        <button type="button" style={styles.secondaryBtn} onClick={handlePreview}>
                          Preview
                        </button>
                      </div>
                    </form>

                    {showPreview && (
                      <div style={styles.previewBox}>
                        <div style={styles.previewHeader}>
                          <span style={styles.label}>Preview (sample data)</span>
                          <button style={styles.linkBtn} onClick={() => setShowPreview(false)}>Close</button>
                        </div>
                        <iframe
                          srcDoc={previewHtml}
                          title="Template preview"
                          style={styles.previewFrame}
                          sandbox="allow-same-origin"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  /* ── Template list ── */
                  templatesLoading ? (
                    <p style={{ color: '#6b7280' }}>Loading templates…</p>
                  ) : (
                    <table style={styles.templateTable}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Event</th>
                          <th style={styles.th}>Subject</th>
                          <th style={styles.th}>Status</th>
                          <th style={styles.th}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {templates.map((tpl) => (
                          <tr key={tpl.eventType} style={styles.tr}>
                            <td style={styles.td}>{EVENT_TYPE_LABELS[tpl.eventType] || tpl.eventType}</td>
                            <td style={{ ...styles.td, color: '#374151', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {tpl.subject}
                            </td>
                            <td style={styles.td}>
                              <span style={tpl.isCustomized ? styles.badgeCustom : styles.badgeDefault}>
                                {tpl.isCustomized ? 'Customized' : 'Default'}
                              </span>
                            </td>
                            <td style={styles.td}>
                              <button style={styles.editBtn} onClick={() => openEditTemplate(tpl)}>Edit</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}

const styles = {
  layout: {
    display: 'flex',
    minHeight: '100vh',
    fontFamily: "'Inter', system-ui, sans-serif",
    background: '#f9fafb',
    color: '#111827',
  },
  sidebar: {
    width: 220,
    background: '#1e293b',
    color: '#f1f5f9',
    display: 'flex',
    flexDirection: 'column',
    padding: '1.5rem 0',
    flexShrink: 0,
  },
  logo: {
    fontSize: '1.25rem',
    fontWeight: 700,
    padding: '0 1.25rem 1.5rem',
    color: '#f1f5f9',
    letterSpacing: '-0.01em',
  },
  nav: { display: 'flex', flexDirection: 'column', flex: 1 },
  navItem: { padding: '0.6rem 1.25rem', color: '#cbd5e1', textDecoration: 'none', fontSize: '0.9rem' },
  navItemActive: { background: '#334155', color: '#f1f5f9', fontWeight: 600 },
  logoutBtn: {
    margin: '1rem 1.25rem 0',
    padding: '0.5rem',
    background: 'transparent',
    border: '1px solid #475569',
    borderRadius: 6,
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
  main: { flex: 1, display: 'flex', flexDirection: 'column', padding: '2rem', maxWidth: 800 },
  header: { marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  pageTitle: { fontSize: '1.5rem', fontWeight: 700, margin: 0 },
  errorBanner: {
    background: '#fee2e2', color: '#991b1b', padding: '0.75rem 1rem',
    borderRadius: 8, marginBottom: '1rem', fontSize: '0.9rem',
  },
  tabBar: { display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb', marginBottom: '1.5rem' },
  tab: {
    padding: '0.55rem 1.1rem',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    marginBottom: -2,
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: '#6b7280',
  },
  tabActive: { borderBottomColor: '#2563eb', color: '#1d4ed8', fontWeight: 600 },
  card: {
    background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb',
    padding: '1.5rem', marginBottom: '1.5rem',
  },
  sectionTitle: { fontSize: '1.05rem', fontWeight: 600, margin: '0 0 0.4rem' },
  sectionDesc: { fontSize: '0.875rem', color: '#6b7280', margin: '0 0 1.25rem' },
  fieldGroup: { marginBottom: '1.25rem' },
  fieldRow: { display: 'flex', gap: '1rem', flexWrap: 'wrap' },
  label: { display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.3rem' },
  fieldHint: { fontSize: '0.8rem', color: '#6b7280', margin: '0 0 0.4rem' },
  input: { width: 140, padding: '0.45rem 0.7rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem', outline: 'none' },
  inputFull: { width: '100%', padding: '0.45rem 0.7rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' },
  passRow: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  showHideBtn: {
    padding: '0.45rem 0.75rem', background: '#f3f4f6', border: '1px solid #d1d5db',
    borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  saveRow: { display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' },
  saveBtn: {
    padding: '0.5rem 1.25rem', background: '#2563eb', color: '#fff',
    border: 'none', borderRadius: 6, fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '0.5rem 1.25rem', background: '#fff', color: '#374151',
    border: '1px solid #d1d5db', borderRadius: 6, fontWeight: 500, fontSize: '0.9rem', cursor: 'pointer',
  },
  saveMsg: { color: '#16a34a', fontSize: '0.875rem', fontWeight: 500 },
  statsTable: { borderCollapse: 'collapse', fontSize: '0.875rem' },
  statLabel: { padding: '0.4rem 1rem 0.4rem 0', color: '#6b7280', fontWeight: 500, whiteSpace: 'nowrap' },
  statValue: { padding: '0.4rem 0', fontWeight: 600 },
  // Templates
  templateTable: { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' },
  th: { textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid #e5e7eb', fontWeight: 600, color: '#374151' },
  tr: { borderBottom: '1px solid #f3f4f6' },
  td: { padding: '0.6rem 0.75rem', color: '#6b7280' },
  badgeCustom: {
    display: 'inline-block', padding: '0.15rem 0.6rem', borderRadius: 12,
    background: '#dbeafe', color: '#1e40af', fontSize: '0.75rem', fontWeight: 600,
  },
  badgeDefault: {
    display: 'inline-block', padding: '0.15rem 0.6rem', borderRadius: 12,
    background: '#f3f4f6', color: '#6b7280', fontSize: '0.75rem', fontWeight: 600,
  },
  editBtn: {
    padding: '0.3rem 0.75rem', background: '#f3f4f6', border: '1px solid #d1d5db',
    borderRadius: 5, fontSize: '0.8rem', cursor: 'pointer', fontWeight: 500,
  },
  editHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  linkBtn: { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.875rem' },
  textarea: {
    width: '100%', boxSizing: 'border-box', padding: '0.6rem', border: '1px solid #d1d5db',
    borderRadius: 6, fontSize: '0.85rem', fontFamily: 'monospace', resize: 'vertical',
  },
  previewBox: { marginTop: '1.5rem', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' },
  previewHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '0.5rem 0.75rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb',
  },
  previewFrame: { width: '100%', height: 360, border: 'none', display: 'block' },
  code: { background: '#f3f4f6', padding: '0.1rem 0.35rem', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.8em' },
}
