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

const FIELD_OPTIONS = [
  { value: 'documentType', label: 'Document Type' },
  { value: 'department', label: 'Department' },
  { value: 'amount', label: 'Amount / Value' },
  { value: 'pageCount', label: 'Page Count' },
  { value: 'wordCount', label: 'Word Count' },
  { value: 'author', label: 'Author' },
  { value: 'title', label: 'Title' },
]

const OP_OPTIONS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
]

function emptyCondition() {
  return { field: 'documentType', op: 'eq', value: '' }
}

function ConditionBuilder({ conditions, onChange }) {
  const { operator = 'AND', conditions: list = [] } = conditions || {}

  function setOperator(op) {
    onChange({ operator: op, conditions: list })
  }

  function setCondition(i, updates) {
    const next = list.map((c, idx) => idx === i ? { ...c, ...updates } : c)
    onChange({ operator, conditions: next })
  }

  function addCondition() {
    onChange({ operator, conditions: [...list, emptyCondition()] })
  }

  function removeCondition(i) {
    onChange({ operator, conditions: list.filter((_, idx) => idx !== i) })
  }

  return (
    <div style={styles.condBuilder}>
      <div style={styles.condHeader}>
        <span style={styles.condLabel}>Match</span>
        <select
          style={styles.condSelect}
          value={operator}
          onChange={e => setOperator(e.target.value)}
        >
          <option value="AND">ALL conditions (AND)</option>
          <option value="OR">ANY condition (OR)</option>
        </select>
      </div>
      {list.map((cond, i) => (
        <div key={i} style={styles.condRow}>
          <select
            style={{ ...styles.condSelect, flex: '0 0 160px' }}
            value={cond.field}
            onChange={e => setCondition(i, { field: e.target.value })}
          >
            {FIELD_OPTIONS.map(f => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
            {cond.field.startsWith('custom.') && (
              <option value={cond.field}>{cond.field}</option>
            )}
          </select>
          <select
            style={{ ...styles.condSelect, flex: '0 0 110px' }}
            value={cond.op}
            onChange={e => setCondition(i, { op: e.target.value })}
          >
            {OP_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <input
            style={{ ...styles.input, flex: 1 }}
            value={cond.value}
            onChange={e => setCondition(i, { value: e.target.value })}
            placeholder="value"
          />
          <button
            type="button"
            onClick={() => removeCondition(i)}
            style={styles.condRemoveBtn}
            title="Remove condition"
          >✕</button>
        </div>
      ))}
      <button type="button" onClick={addCondition} style={styles.condAddBtn}>
        + Add Condition
      </button>
      {list.length === 0 && (
        <p style={styles.condHint}>No conditions — rule matches all documents.</p>
      )}
    </div>
  )
}

function describeConditions(conditions) {
  if (!conditions || !conditions.conditions || conditions.conditions.length === 0) return '—'
  const op = conditions.operator || 'AND'
  return conditions.conditions
    .map(c => `${c.field} ${c.op} "${c.value}"`)
    .join(` ${op} `)
}

export default function RoutingRulesAdmin() {
  const navigate = useNavigate()
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState(null)
  const [form, setForm] = useState({
    name: '', documentType: '', departmentTag: '', targetQueue: '', priority: '1',
    useConditions: false, conditions: { operator: 'AND', conditions: [] },
  })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) { navigate('/login'); return }
    if (getUserRole(token) !== 'admin') { navigate('/dashboard'); return }
    loadRules(token)
  }, [navigate])

  function loadRules(token) {
    const t = token || localStorage.getItem('token')
    setLoading(true)
    fetch('/api/routing-rules', {
      headers: { Authorization: `Bearer ${t}` },
    })
      .then(res => {
        if (res.status === 401) { navigate('/login'); return null }
        if (res.status === 403) { navigate('/dashboard'); return null }
        return res.json()
      })
      .then(data => { if (data) setRules(data) })
      .catch(() => setError('Failed to load routing rules.'))
      .finally(() => setLoading(false))
  }

  function openAddModal() {
    setEditingRule(null)
    setForm({
      name: '', documentType: '', departmentTag: '', targetQueue: '',
      priority: String(rules.length + 1),
      useConditions: false, conditions: { operator: 'AND', conditions: [] },
    })
    setFormError('')
    setModalOpen(true)
  }

  function openEditModal(rule) {
    setEditingRule(rule)
    const hasConditions = rule.conditions != null
    setForm({
      name: rule.name,
      documentType: rule.documentType || '',
      departmentTag: rule.departmentTag || '',
      targetQueue: rule.targetQueue,
      priority: String(rule.priority),
      useConditions: hasConditions,
      conditions: rule.conditions || { operator: 'AND', conditions: [] },
    })
    setFormError('')
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingRule(null)
  }

  async function handleSave() {
    if (!form.name.trim()) { setFormError('Name is required.'); return }
    if (!form.targetQueue.trim()) { setFormError('Target Queue is required.'); return }
    if (!form.priority || isNaN(Number(form.priority))) { setFormError('Priority must be a number.'); return }

    // Validate conditions if enabled
    if (form.useConditions) {
      for (const c of form.conditions.conditions || []) {
        if (!c.value && c.value !== 0) {
          setFormError('All conditions must have a value.')
          return
        }
      }
    }

    setSaving(true)
    setFormError('')
    const token = localStorage.getItem('token')
    const body = {
      name: form.name.trim(),
      targetQueue: form.targetQueue.trim(),
      priority: Number(form.priority),
    }
    if (form.useConditions) {
      body.conditions = form.conditions
    } else {
      body.documentType = form.documentType.trim() || null
      body.departmentTag = form.departmentTag.trim() || null
      body.conditions = null
    }

    try {
      const res = editingRule
        ? await fetch(`/api/routing-rules/${editingRule.id}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/routing-rules', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setFormError(err.error || 'Failed to save rule.')
        return
      }
      closeModal()
      loadRules()
    } catch {
      setFormError('Failed to save rule.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(rule) {
    const token = localStorage.getItem('token')
    try {
      await fetch(`/api/routing-rules/${rule.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      })
      loadRules()
    } catch {
      setError('Failed to deactivate rule.')
    }
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
          <Link to="/dashboard" style={styles.navItem}>Documents</Link>
          <Link to="/dashboard" style={styles.navItem}>Workflows</Link>
          <Link to="/approvals" style={styles.navItem}>Approvals</Link>
          <Link to="/dashboard" style={styles.navItem}>Settings</Link>
          <Link to="/admin/routing-rules" style={{ ...styles.navItem, ...styles.navItemActive }}>Routing Rules</Link>
        </nav>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.pageTitle}>Routing Rules</h1>
          <NotificationBell />
          <button onClick={openAddModal} style={styles.addBtn}>+ Add Rule</button>
        </header>
        <div style={styles.content}>
          {loading && <p style={styles.message}>Loading…</p>}
          {error && <p style={{ ...styles.message, color: '#dc2626' }}>{error}</p>}
          {!loading && !error && rules.length === 0 && (
            <div style={styles.empty}>
              <p style={styles.emptyText}>No routing rules configured. Add one to get started.</p>
            </div>
          )}
          {!loading && rules.length > 0 && (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Name</th>
                    <th style={styles.th}>Conditions</th>
                    <th style={styles.th}>Target Queue</th>
                    <th style={styles.th}>Priority</th>
                    <th style={styles.th}>Active</th>
                    <th style={styles.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map(rule => (
                    <tr key={rule.id} style={styles.row}>
                      <td style={styles.td}>{rule.name}</td>
                      <td style={{ ...styles.td, ...styles.condCell }}>
                        {rule.conditions
                          ? <span style={styles.condTag}>{describeConditions(rule.conditions)}</span>
                          : <span style={styles.legacyTag}>
                              {[rule.documentType && `type=${rule.documentType}`, rule.departmentTag && `dept=${rule.departmentTag}`].filter(Boolean).join(', ') || 'match all'}
                            </span>
                        }
                      </td>
                      <td style={styles.td}>{rule.targetQueue}</td>
                      <td style={styles.td}>{rule.priority}</td>
                      <td style={styles.td}>
                        <span style={rule.isActive ? styles.activeChip : styles.inactiveChip}>
                          {rule.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <button onClick={() => openEditModal(rule)} style={styles.actionBtn}>Edit</button>
                        {rule.isActive && (
                          <button onClick={() => handleDeactivate(rule)} style={{ ...styles.actionBtn, ...styles.deactivateBtn }}>Deactivate</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {modalOpen && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h2 style={styles.modalTitle}>{editingRule ? 'Edit Rule' : 'Add Rule'}</h2>
            <div style={styles.formField}>
              <label style={styles.label}>Name *</label>
              <input
                style={styles.input}
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g., HR Policy Documents"
              />
            </div>
            <div style={styles.formField}>
              <label style={styles.label}>Target Queue *</label>
              <input
                style={styles.input}
                value={form.targetQueue}
                onChange={e => setForm({ ...form, targetQueue: e.target.value })}
                placeholder="e.g., hr-approvals"
              />
            </div>
            <div style={styles.formField}>
              <label style={styles.label}>Priority *</label>
              <input
                style={styles.input}
                type="number"
                min="1"
                value={form.priority}
                onChange={e => setForm({ ...form, priority: e.target.value })}
                placeholder="1 (lower number = higher priority)"
              />
            </div>

            <div style={styles.matchModeToggle}>
              <label style={styles.label}>Match mode</label>
              <div style={styles.toggleRow}>
                <button
                  type="button"
                  style={form.useConditions ? styles.toggleBtnOff : styles.toggleBtnOn}
                  onClick={() => setForm({ ...form, useConditions: false })}
                >
                  Simple (type/department)
                </button>
                <button
                  type="button"
                  style={form.useConditions ? styles.toggleBtnOn : styles.toggleBtnOff}
                  onClick={() => setForm({ ...form, useConditions: true })}
                >
                  Condition Builder
                </button>
              </div>
            </div>

            {!form.useConditions ? (
              <>
                <div style={styles.formField}>
                  <label style={styles.label}>Document Type</label>
                  <input
                    style={styles.input}
                    value={form.documentType}
                    onChange={e => setForm({ ...form, documentType: e.target.value })}
                    placeholder="e.g., policy (leave blank to match any)"
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Department Tag</label>
                  <input
                    style={styles.input}
                    value={form.departmentTag}
                    onChange={e => setForm({ ...form, departmentTag: e.target.value })}
                    placeholder="e.g., hr (leave blank to match any)"
                  />
                </div>
              </>
            ) : (
              <div style={styles.formField}>
                <label style={styles.label}>Conditions</label>
                <ConditionBuilder
                  conditions={form.conditions}
                  onChange={conditions => setForm({ ...form, conditions })}
                />
              </div>
            )}

            {formError && <p style={styles.formError}>{formError}</p>}
            <div style={styles.modalActions}>
              <button onClick={closeModal} style={styles.cancelBtn} disabled={saving}>Cancel</button>
              <button onClick={handleSave} style={styles.saveBtn} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pageTitle: {
    fontSize: '1.25rem',
    fontWeight: 600,
    color: '#111827',
  },
  addBtn: {
    padding: '0.5rem 1rem',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
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
  row: {
    borderBottom: '1px solid #f3f4f6',
  },
  td: {
    padding: '0.875rem 1rem',
    color: '#111827',
    verticalAlign: 'middle',
  },
  condCell: {
    maxWidth: '300px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  condTag: {
    display: 'inline-block',
    padding: '0.2rem 0.5rem',
    borderRadius: '4px',
    background: '#eff6ff',
    color: '#1d4ed8',
    fontSize: '0.75rem',
    fontFamily: 'monospace',
  },
  legacyTag: {
    color: '#6b7280',
    fontSize: '0.85rem',
  },
  activeChip: {
    display: 'inline-block',
    padding: '0.25rem 0.625rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: 600,
    background: '#dcfce7',
    color: '#166534',
  },
  inactiveChip: {
    display: 'inline-block',
    padding: '0.25rem 0.625rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: 600,
    background: '#f3f4f6',
    color: '#6b7280',
  },
  actionBtn: {
    marginRight: '0.5rem',
    padding: '0.375rem 0.75rem',
    background: 'transparent',
    border: '1px solid #d1d5db',
    borderRadius: '5px',
    fontSize: '0.8rem',
    cursor: 'pointer',
    color: '#374151',
  },
  deactivateBtn: {
    color: '#b45309',
    borderColor: '#fcd34d',
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  modal: {
    background: '#fff',
    borderRadius: '12px',
    padding: '2rem',
    width: '540px',
    maxWidth: '95vw',
    maxHeight: '90vh',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
  },
  modalTitle: {
    fontSize: '1.1rem',
    fontWeight: 600,
    color: '#111827',
    margin: 0,
  },
  formField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
  },
  label: {
    fontSize: '0.8rem',
    fontWeight: 500,
    color: '#374151',
  },
  input: {
    padding: '0.5rem 0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.9rem',
    color: '#111827',
    outline: 'none',
  },
  matchModeToggle: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
  },
  toggleRow: {
    display: 'flex',
    gap: '0.5rem',
  },
  toggleBtnOn: {
    padding: '0.375rem 0.75rem',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  toggleBtnOff: {
    padding: '0.375rem 0.75rem',
    background: 'transparent',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.8rem',
    cursor: 'pointer',
  },
  condBuilder: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    padding: '0.75rem',
    background: '#f8fafc',
    borderRadius: '8px',
    border: '1px solid #e2e8f0',
  },
  condHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  condLabel: {
    fontSize: '0.8rem',
    fontWeight: 500,
    color: '#374151',
    whiteSpace: 'nowrap',
  },
  condSelect: {
    padding: '0.375rem 0.5rem',
    border: '1px solid #d1d5db',
    borderRadius: '5px',
    fontSize: '0.85rem',
    color: '#111827',
    background: '#fff',
  },
  condRow: {
    display: 'flex',
    gap: '0.375rem',
    alignItems: 'center',
  },
  condRemoveBtn: {
    padding: '0.25rem 0.5rem',
    background: 'transparent',
    border: '1px solid #fca5a5',
    borderRadius: '4px',
    color: '#dc2626',
    cursor: 'pointer',
    fontSize: '0.75rem',
    flexShrink: 0,
  },
  condAddBtn: {
    alignSelf: 'flex-start',
    padding: '0.375rem 0.75rem',
    background: 'transparent',
    border: '1px dashed #93c5fd',
    borderRadius: '5px',
    color: '#2563eb',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontWeight: 500,
  },
  condHint: {
    color: '#6b7280',
    fontSize: '0.8rem',
    margin: 0,
    fontStyle: 'italic',
  },
  formError: {
    color: '#dc2626',
    fontSize: '0.85rem',
    margin: 0,
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.75rem',
    marginTop: '0.5rem',
  },
  cancelBtn: {
    padding: '0.5rem 1rem',
    background: 'transparent',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.875rem',
    cursor: 'pointer',
    color: '#374151',
  },
  saveBtn: {
    padding: '0.5rem 1rem',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
}
