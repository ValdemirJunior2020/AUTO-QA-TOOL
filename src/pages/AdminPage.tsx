import { useEffect, useMemo, useState } from 'react'
import type { AppSettings, CriterionDefinition, QaType, QaUser, UserRole } from '../types'
import { ADMIN_EMAILS, OWNER_EMAIL, SUPER_ADMIN_EMAILS, normalizeEmail } from '../lib/firebase'
import { tryExtractSalesCriteria, workbookToQaText } from '../lib/autoQa'
const RETIRED_USER_EMAILS = new Set(['barbara.kalchik@hotelplanner.com'])

interface AdminPageProps {
  currentUser: QaUser
  users: QaUser[]
  settings: AppSettings
  onSaveUser: (user: QaUser) => Promise<void>
  onSetBlocked: (email: string, blocked: boolean) => Promise<void>
  onSaveSettings: (settings: AppSettings) => Promise<void>
  onImportLegacyWorkbook: (file: File) => Promise<unknown>
  busy: boolean
}

const emptyPermissions = {
  canSubmitReviews: true,
  canViewHistory: true,
  canEditAgentDetails: true,
  canEditCriteriaSelections: true,
  canEditCustomNotes: true,
}

function newUser(): QaUser {
  return {
    email: '',
    displayName: '',
    role: 'evaluator',
    active: true,
    guidedMode: false,
    notes: '',
    permissions: { ...emptyPermissions },
  }
}

export function AdminPage({
  currentUser,
  users,
  settings,
  onSaveUser,
  onSetBlocked,
  onSaveSettings,
  onImportLegacyWorkbook,
  busy,
}: AdminPageProps) {
  const [section, setSection] = useState<'team' | 'criteria' | 'rules' | 'autoqa'>('team')
  const [editingUser, setEditingUser] = useState<QaUser | null>(null)
  const [draftSettings, setDraftSettings] = useState<AppSettings>(() => structuredClone(settings))
  const [newCenter, setNewCenter] = useState('')
  const [editingCenterIndex, setEditingCenterIndex] = useState<number | null>(null)
  const [editingCenterValue, setEditingCenterValue] = useState('')
  const [legacyFile, setLegacyFile] = useState<File | null>(null)
  const [migrationMessage, setMigrationMessage] = useState('')
  const [autoQaMessage, setAutoQaMessage] = useState('')

  const visibleUsers = useMemo(() => {
    const seen = new Set<string>()

    return users.filter((user) => {
      const email = user.email.trim().toLowerCase()

      if (!email || RETIRED_USER_EMAILS.has(email) || seen.has(email)) {
        return false
      }

      seen.add(email)
      return true
    })
  }, [users])

  const admins = useMemo(
    () => visibleUsers.filter((user) => user.role === 'admin'),
    [visibleUsers],
  )

  const currentUserEmail = normalizeEmail(currentUser.email)
  const isSuperAdmin = SUPER_ADMIN_EMAILS.has(currentUserEmail)
  const isOwner = currentUserEmail === OWNER_EMAIL

  // Keep the editable copy in sync with the latest settings returned by Firebase.
  useEffect(() => {
    setDraftSettings(structuredClone(settings))
  }, [settings])

  const saveUser = async () => {
    if (!editingUser) return
    if (!editingUser.displayName.trim() || !editingUser.email.trim()) {
      window.alert('Name and email are required.')
      return
    }
    await onSaveUser({
      ...editingUser,
      email: editingUser.email.trim().toLowerCase(),
      displayName: editingUser.displayName.trim(),
    })
    setEditingUser(null)
  }

  const updateCriterion = (qaType: QaType, index: number, patch: Partial<CriterionDefinition>) => {
    setDraftSettings((current) => ({
      ...current,
      criteria: {
        ...current.criteria,
        [qaType]: current.criteria[qaType].map((criterion, criterionIndex) =>
          criterionIndex === index ? { ...criterion, ...patch } : criterion,
        ),
      },
    }))
  }


  const addSalesCriterion = () => {
    setDraftSettings((current) => {
      const nextNumber = current.criteria.Sales.length + 1
      return {
        ...current,
        criteria: {
          ...current.criteria,
          Sales: [
            ...current.criteria.Sales,
            { number: nextNumber, name: '', points: 0, notes: '' },
          ],
        },
      }
    })
  }

  const removeSalesCriterion = (index: number) => {
    setDraftSettings((current) => ({
      ...current,
      criteria: {
        ...current.criteria,
        Sales: current.criteria.Sales
          .filter((_, criterionIndex) => criterionIndex !== index)
          .map((criterion, criterionIndex) => ({ ...criterion, number: criterionIndex + 1 })),
      },
    }))
  }

  const saveCallCenters = async (callCenters: string[]) => {
    const nextSettings = { ...draftSettings, callCenters }
    await onSaveSettings(nextSettings)
    setDraftSettings(nextSettings)
  }

  const addCenter = async () => {
    const center = newCenter.trim()
    if (!center || busy) return
    if (draftSettings.callCenters.some((item) => item.toLowerCase() === center.toLowerCase())) {
      window.alert('That call center is already in the list.')
      return
    }

    await saveCallCenters([...draftSettings.callCenters, center])
    setNewCenter('')
  }

  const startEditingCenter = (index: number) => {
    setEditingCenterIndex(index)
    setEditingCenterValue(draftSettings.callCenters[index] || '')
  }

  const cancelEditingCenter = () => {
    setEditingCenterIndex(null)
    setEditingCenterValue('')
  }

  const saveEditedCenter = async () => {
    if (editingCenterIndex === null || busy) return
    const center = editingCenterValue.trim()
    if (!center) {
      window.alert('Call center name cannot be blank.')
      return
    }

    const duplicate = draftSettings.callCenters.some(
      (item, index) => index !== editingCenterIndex && item.toLowerCase() === center.toLowerCase(),
    )
    if (duplicate) {
      window.alert('That call center is already in the list.')
      return
    }

    const nextCenters = draftSettings.callCenters.map((item, index) =>
      index === editingCenterIndex ? center : item,
    )
    await saveCallCenters(nextCenters)
    cancelEditingCenter()
  }

  const deleteCenter = async (index: number) => {
    if (busy) return
    const center = draftSettings.callCenters[index]
    if (!center) return
    if (!window.confirm(`Delete ${center} from the Call Center list?`)) return

    const nextCenters = draftSettings.callCenters.filter((_, itemIndex) => itemIndex !== index)
    await saveCallCenters(nextCenters)
    if (editingCenterIndex === index) cancelEditingCenter()
  }

  const saveSettings = async () => {
    const csTotal = draftSettings.criteria.CS.reduce((sum, criterion) => sum + Number(criterion.points || 0), 0)
    const groupsTotal = draftSettings.criteria.Groups.reduce((sum, criterion) => sum + Number(criterion.points || 0), 0)
    const salesTotal = draftSettings.criteria.Sales.reduce((sum, criterion) => sum + Number(criterion.points || 0), 0)
    const salesInvalid = draftSettings.criteria.Sales.length > 0 && salesTotal !== 100
    if (csTotal !== 100 || groupsTotal !== 100 || salesInvalid) {
      const salesMessage = draftSettings.criteria.Sales.length ? ` and Sales totals ${salesTotal} points` : ' and Sales matrix is still pending'
      const proceed = window.confirm(`CS totals ${csTotal} points, Groups totals ${groupsTotal} points${salesMessage}. Save anyway?`)
      if (!proceed) return
    }
    await onSaveSettings(draftSettings)
  }


  const importMatrixFile = async (file: File | null) => {
    if (!file) return
    setAutoQaMessage('Reading Matrix…')
    try {
      const imported = await workbookToQaText(file)
      setDraftSettings((current) => ({
        ...current,
        autoQa: {
          ...current.autoQa,
          matrixText: imported.text,
          matrixFileName: imported.fileName,
          matrixUpdatedAt: new Date().toISOString(),
        },
      }))
      setAutoQaMessage(`Loaded ${imported.fileName} (${imported.sheets.join(', ')}). Click Save Auto QA Settings.`)
    } catch (error) {
      setAutoQaMessage(error instanceof Error ? error.message : 'Could not read the Matrix workbook.')
    }
  }

  const importSalesQaForm = async (file: File | null) => {
    if (!file) return
    setAutoQaMessage('Reading Group Sales QA form…')
    try {
      const imported = await workbookToQaText(file)
      const extracted = tryExtractSalesCriteria(imported.text)
      setDraftSettings((current) => ({
        ...current,
        criteria: extracted.length ? { ...current.criteria, Sales: extracted } : current.criteria,
        autoQa: {
          ...current.autoQa,
          salesQaFormText: imported.text,
          salesQaFormFileName: imported.fileName,
          salesQaFormUpdatedAt: new Date().toISOString(),
        },
      }))
      setAutoQaMessage(extracted.length
        ? `Loaded ${imported.fileName} and detected ${extracted.length} Sales criteria. Review them in Criteria, then save.`
        : `Loaded ${imported.fileName}. The form is available to Auto QA; criteria were not auto-detected, so you can enter them in Criteria if needed.`)
    } catch (error) {
      setAutoQaMessage(error instanceof Error ? error.message : 'Could not read the Group Sales QA form.')
    }
  }

  const importLegacy = async () => {
    if (!legacyFile || busy) return
    if (!window.confirm(`Import ${legacyFile.name} into Firebase? Existing documents with the same Request ID / legacy row ID will be updated, not duplicated.`)) return
    setMigrationMessage('')
    try {
      await onImportLegacyWorkbook(legacyFile)
      setMigrationMessage('Legacy workbook imported successfully. Firebase is now the live database.')
      setLegacyFile(null)
    } catch (error) {
      setMigrationMessage(error instanceof Error ? error.message : 'Legacy workbook import failed.')
    }
  }

  return (
    <div className="page-stack">
      <section className="admin-intro">
        <div>
          <p className="eyebrow">Administrator access</p>
          <h1>Control who can use and change the QA app.</h1>
          <p>
            Junior and Barbara are Super Admins. April Grantham, Jim Fryer, and Karen Caldas are Admins. Other people can be added as evaluators or viewers and given only the access they need.
          </p>
        </div>
        <div className="admin-summary">
          <span>{admins.length} administrator accounts</span>
          <strong>2 Super Admins · 3 Admins</strong>
        </div>
      </section>

      <div className="segmented-control" role="tablist">
        <button type="button" className={section === 'team' ? 'active' : ''} onClick={() => setSection('team')}>Team & Access</button>
        <button type="button" className={section === 'criteria' ? 'active' : ''} onClick={() => setSection('criteria')}>Criteria</button>
        <button type="button" className={section === 'rules' ? 'active' : ''} onClick={() => setSection('rules')}>Rules & Centers</button>
        <button type="button" className={section === 'autoqa' ? 'active' : ''} onClick={() => setSection('autoqa')}>Auto QA</button>
      </div>

      {section === 'team' && (
        <section className="panel">
          <div className="panel-heading wrap-heading">
            <div>
              <p className="eyebrow">People</p>
              <h2>Evaluator Access</h2>
            </div>
            <button type="button" className="primary-button" onClick={() => setEditingUser(newUser())}>Add Person</button>
          </div>

          <div className="team-grid">
            {visibleUsers.map((user) => {
              const userEmail = normalizeEmail(user.email)
              const isTargetSuperAdmin = SUPER_ADMIN_EMAILS.has(userEmail)
              const isTargetAdmin = ADMIN_EMAILS.has(userEmail) || user.role === 'admin'
              const canManageTarget = !isTargetSuperAdmin && (!isTargetAdmin || isSuperAdmin)
              const canBlockTarget = !isTargetSuperAdmin && (!isTargetAdmin || isSuperAdmin)

              return (
                <article key={user.email} className={`team-card ${!user.active ? 'disabled' : ''}`}>
                  <div className="team-card-heading">
                    <div className="avatar large">{user.displayName.slice(0, 1).toUpperCase()}</div>
                    <div>
                      <h3>{user.displayName}</h3>
                      <p>{user.email}</p>
                    </div>
                    <span className={`role-pill ${user.role}`}>{isTargetSuperAdmin ? 'Super Admin' : user.role}</span>
                  </div>

                  <div className="permission-chips">
                    <span>{user.active ? 'Active' : 'Blocked'}</span>
                    <span>{user.permissions.canSubmitReviews ? 'Can submit' : 'No submissions'}</span>
                    {user.guidedMode && <span className="guided-chip">Guided Mode</span>}
                  </div>

                  {user.notes && <p className="team-note">{user.notes}</p>}

                  <div className="team-actions">
                    <button
                      type="button"
                      className="secondary-button compact"
                      onClick={() => {
                        if (!canManageTarget) {
                          window.alert(
                            isTargetSuperAdmin
                              ? 'Junior and Barbara are protected Super Admin accounts.'
                              : 'Only Junior or Barbara can change another administrator account.',
                          )
                          return
                        }
                        setEditingUser(structuredClone(user))
                      }}
                      title={!canManageTarget ? (isTargetSuperAdmin ? 'Protected Super Admin' : 'Super Admin approval required') : undefined}
                    >
                      {canManageTarget ? 'Edit' : isTargetSuperAdmin ? 'Protected Super Admin' : 'Super Admin Only'}
                    </button>
                    {!canBlockTarget && isTargetSuperAdmin && (
                      <button type="button" className="secondary-button compact" onClick={() => window.alert('Junior and Barbara are protected Super Admin accounts and cannot be blocked.')}>Protected</button>
                    )}
                    {canBlockTarget && (
                      <button
                        type="button"
                        className={user.active ? 'danger-button compact' : 'success-button compact'}
                        onClick={() => onSetBlocked(user.email, user.active)}
                        disabled={busy}
                      >
                        {user.active ? 'Block' : 'Unblock'}
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {section === 'team' && isOwner && (
        <section className="panel firebase-migration-panel">
          <div className="panel-heading wrap-heading">
            <div>
              <p className="eyebrow">One-time Firebase migration</p>
              <h2>Import the legacy QA Google Sheet workbook</h2>
              <p className="muted">Junior only. This imports Agents Reviewed, evaluator access, QA settings, all criteria, notes, call IDs, itinerary numbers, email status, dates, scores, and legacy row numbers. It can safely be re-run because legacy rows use stable IDs.</p>
            </div>
          </div>
          <div className="migration-controls">
            <label className="field">
              <span>Legacy QA Excel workbook</span>
              <input type="file" accept=".xlsx" disabled={busy} onChange={(event) => setLegacyFile(event.target.files?.[0] || null)} />
            </label>
            <button type="button" className="primary-button" disabled={!legacyFile || busy} onClick={() => void importLegacy()}>
              {busy ? 'Importing…' : 'Import Workbook to Firebase'}
            </button>
          </div>
          {migrationMessage && <p className="muted">{migrationMessage}</p>}
        </section>
      )}

      {section === 'criteria' && (
        <section className="panel">
          <div className="panel-heading wrap-heading">
            <div>
              <p className="eyebrow">Scoring content</p>
              <h2>Edit Criteria and Points</h2>
              <p className="muted">Changes apply to new reviews. Existing saved reviews stay unchanged.</p>
            </div>
            <button type="button" className="primary-button" onClick={saveSettings} disabled={busy}>Save Criteria</button>
          </div>

          {(['CS', 'Groups', 'Sales'] as QaType[]).map((qaType) => (
            <div key={qaType} className="criteria-editor-section">
              <div className="criteria-editor-heading">
                <h3>{qaType} Criteria</h3>
                <span>{draftSettings.criteria[qaType].reduce((sum, item) => sum + Number(item.points || 0), 0)} total points</span>
                {qaType === 'Sales' && <button type="button" className="secondary-button compact" onClick={addSalesCriterion}>Add Sales Criterion</button>}
              </div>
              <div className="criteria-editor-list">
                {qaType === 'Sales' && draftSettings.criteria.Sales.length === 0 && <p className="muted">Sales matrix pending Ann Stephenson / April approval. Sales reviews stay disabled until approved criteria are added here.</p>}
                {draftSettings.criteria[qaType].map((criterion, index) => (
                  <article key={`${qaType}-${criterion.number}`} className="criteria-editor-card">
                    <div className="criterion-number">{criterion.number}</div>
                    <label className="field">
                      <span>Criteria name</span>
                      <input value={criterion.name} onChange={(event) => updateCriterion(qaType, index, { name: event.target.value })} />
                    </label>
                    <label className="field points-field">
                      <span>Points</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={criterion.points}
                        onChange={(event) => updateCriterion(qaType, index, { points: Number(event.target.value) })}
                      />
                    </label>
                    <label className="field wide-field">
                      <span>Notes / Issue Found description</span>
                      <textarea value={criterion.notes} onChange={(event) => updateCriterion(qaType, index, { notes: event.target.value })} />
                    </label>
                    {qaType === 'Sales' && <button type="button" className="danger-button compact" onClick={() => removeSalesCriterion(index)}>Remove</button>}
                  </article>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {section === 'autoqa' && (
        <section className="panel autoqa-admin-panel">
          <div className="panel-heading wrap-heading">
            <div>
              <p className="eyebrow">Local Auto QA</p>
              <h2>Ollama, Matrix and Group Sales Form</h2>
              <p className="muted">Runs through your local Auto QA companion service. No paid AI API key is required.</p>
            </div>
            <button type="button" className="primary-button" onClick={saveSettings} disabled={busy}>Save Auto QA Settings</button>
          </div>

          <div className="rule-grid">
            <label className="toggle-row">
              <input type="checkbox" checked={draftSettings.autoQa.enabled} onChange={(event) => setDraftSettings((current) => ({ ...current, autoQa: { ...current.autoQa, enabled: event.target.checked } }))} />
              <span><strong>Enable Auto QA</strong><small>Manual QA remains available even when this is enabled.</small></span>
            </label>
            <label className="field">
              <span>Ollama Model</span>
              <input value={draftSettings.autoQa.ollamaModel} onChange={(event) => setDraftSettings((current) => ({ ...current, autoQa: { ...current.autoQa, ollamaModel: event.target.value } }))} />
              <em>Default: qwen3:8b</em>
            </label>
            <label className="field">
              <span>Ollama URL</span>
              <input value={draftSettings.autoQa.ollamaUrl} onChange={(event) => setDraftSettings((current) => ({ ...current, autoQa: { ...current.autoQa, ollamaUrl: event.target.value } }))} />
            </label>
            <label className="field">
              <span>Local Auto QA Service</span>
              <input value={draftSettings.autoQa.serviceUrl} onChange={(event) => setDraftSettings((current) => ({ ...current, autoQa: { ...current.autoQa, serviceUrl: event.target.value } }))} />
            </label>
          </div>

          <div className="autoqa-upload-grid">
            <article className="autoqa-upload-card">
              <h3>Service Matrix</h3>
              <p className="muted">Current: <strong>{draftSettings.autoQa.matrixFileName || 'No Matrix uploaded'}</strong></p>
              <p className="muted">Upload a new .xlsx whenever the Matrix changes. Auto QA will use the newest saved version.</p>
              <input type="file" accept=".xlsx" disabled={busy} onChange={(event) => void importMatrixFile(event.target.files?.[0] || null)} />
            </article>

            <article className="autoqa-upload-card">
              <h3>Group Sales QA Form</h3>
              <p className="muted">Current: <strong>{draftSettings.autoQa.salesQaFormFileName || 'Not uploaded yet'}</strong></p>
              <p className="muted">Upload Barbara's future Group Sales QA workbook here. If its criteria and points are recognizable, the Sales criteria will be filled automatically.</p>
              <input type="file" accept=".xlsx" disabled={busy} onChange={(event) => void importSalesQaForm(event.target.files?.[0] || null)} />
            </article>
          </div>

          {autoQaMessage && <div className="validation-banner"><span>{autoQaMessage}</span></div>}
        </section>
      )}

      {section === 'rules' && (
        <section className="panel">
          <div className="panel-heading wrap-heading">
            <div>
              <p className="eyebrow">Form rules</p>
              <h2>Required Fields and Call Centers</h2>
            </div>
            <button type="button" className="primary-button" onClick={saveSettings} disabled={busy}>Save Rules</button>
          </div>

          <div className="rule-grid">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={draftSettings.rules.callIdRequired}
                onChange={(event) => setDraftSettings((current) => ({ ...current, rules: { ...current.rules, callIdRequired: event.target.checked } }))}
              />
              <span><strong>Call ID required</strong><small>Every review must include a Call ID.</small></span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={draftSettings.rules.confirmationRequired}
                onChange={(event) => setDraftSettings((current) => ({ ...current, rules: { ...current.rules, confirmationRequired: event.target.checked } }))}
              />
              <span><strong>Confirmation required</strong><small>Accept any itinerary, confirmation, reservation, or supplier reference.</small></span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={draftSettings.rules.noteRequiredForMarkdownOrPartial}
                onChange={(event) => setDraftSettings((current) => ({ ...current, rules: { ...current.rules, noteRequiredForMarkdownOrPartial: event.target.checked } }))}
              />
              <span><strong>Require notes for Markdown and Partial</strong><small>Prevents saving without a clear explanation.</small></span>
            </label>
            <label className="field">
              <span>CS KPI</span>
              <input
                type="number"
                value={draftSettings.rules.csKpi}
                onChange={(event) => setDraftSettings((current) => ({ ...current, rules: { ...current.rules, csKpi: Number(event.target.value) } }))}
              />
            </label>
            <label className="field">
              <span>Sales KPI</span>
              <input
                type="number"
                value={draftSettings.rules.salesKpi}
                onChange={(event) => setDraftSettings((current) => ({ ...current, rules: { ...current.rules, salesKpi: Number(event.target.value) } }))}
              />
            </label>
            <label className="field">
              <span>Groups KPI</span>
              <input
                type="number"
                value={draftSettings.rules.groupsKpi}
                onChange={(event) => setDraftSettings((current) => ({ ...current, rules: { ...current.rules, groupsKpi: Number(event.target.value) } }))}
              />
            </label>
            <label className="field wide-field">
              <span>Guided Call ID pattern</span>
              <input
                value={draftSettings.rules.guidedCallIdPattern}
                onChange={(event) => setDraftSettings((current) => ({ ...current, rules: { ...current.rules, guidedCallIdPattern: event.target.value } }))}
              />
              <em>Default: CA followed by exactly 32 hexadecimal characters.</em>
            </label>
          </div>

          <div className="center-manager">
            <h3>Call Centers</h3>
            <p className="muted">Junior and Barbara can add, rename, or delete call centers. Changes save to Firebase immediately.</p>

            <div className="center-chips">
              {draftSettings.callCenters.map((center, index) => (
                <span key={`${center}-${index}`}>
                  {editingCenterIndex === index ? (
                    <>
                      <input
                        value={editingCenterValue}
                        onChange={(event) => setEditingCenterValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveEditedCenter()
                          if (event.key === 'Escape') cancelEditingCenter()
                        }}
                        autoFocus
                      />
                      <button type="button" onClick={() => void saveEditedCenter()} disabled={busy} aria-label={`Save ${center}`}>✓</button>
                      <button type="button" onClick={cancelEditingCenter} disabled={busy} aria-label={`Cancel editing ${center}`}>×</button>
                    </>
                  ) : (
                    <>
                      {center}
                      <button type="button" onClick={() => startEditingCenter(index)} disabled={busy} aria-label={`Edit ${center}`}>✎</button>
                      <button type="button" onClick={() => void deleteCenter(index)} disabled={busy} aria-label={`Delete ${center}`}>×</button>
                    </>
                  )}
                </span>
              ))}
            </div>

            <div className="inline-add">
              <input
                value={newCenter}
                onChange={(event) => setNewCenter(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void addCenter() }}
                placeholder="New call center"
                disabled={busy}
              />
              <button type="button" className="secondary-button" onClick={() => void addCenter()} disabled={busy}>Add & Save</button>
            </div>
          </div>
        </section>
      )}

      {editingUser && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card user-modal" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
            <p className="eyebrow">Access control</p>
            <h2 id="user-modal-title">{visibleUsers.some((user) => user.email === editingUser.email) ? 'Edit Person' : 'Add Person'}</h2>

            <div className="modal-form-grid">
              <label className="field">
                <span>Name</span>
                <input value={editingUser.displayName} onChange={(event) => setEditingUser({ ...editingUser, displayName: event.target.value })} />
              </label>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  value={editingUser.email}
                  onChange={(event) => setEditingUser({ ...editingUser, email: event.target.value })}
                  disabled={visibleUsers.some((user) => user.email === editingUser.email)}
                />
              </label>
              <label className="field">
                <span>Role</span>
                <select
                  value={editingUser.role}
                  onChange={(event) =>
                    setEditingUser({
                      ...editingUser,
                      role: event.target.value as UserRole,
                    })
                  }
                  disabled={
                    SUPER_ADMIN_EMAILS.has(normalizeEmail(editingUser.email)) ||
                    (!isSuperAdmin && editingUser.role === 'admin')
                  }
                >
                  <option value="evaluator">Evaluator</option>
                  <option value="viewer">Viewer</option>
                  {(editingUser.role === 'admin' || (isSuperAdmin && ADMIN_EMAILS.has(normalizeEmail(editingUser.email)))) && (
                    <option value="admin">Admin</option>
                  )}
                </select>
                <em>
                  Junior and Barbara are protected Super Admins. Only a Super Admin can create or change other Admin accounts.
                </em>
              </label>
              <label className="field wide-field">
                <span>Admin note</span>
                <textarea value={editingUser.notes} onChange={(event) => setEditingUser({ ...editingUser, notes: event.target.value })} placeholder="Optional internal note" />
              </label>
            </div>

            <div className="permission-editor">
              <label className="toggle-row">
                <input type="checkbox" checked={editingUser.active} onChange={(event) => setEditingUser({ ...editingUser, active: event.target.checked })} disabled={
                    SUPER_ADMIN_EMAILS.has(normalizeEmail(editingUser.email)) ||
                    (!isSuperAdmin && editingUser.role === 'admin')
                  }
                />
                <span><strong>Account active</strong><small>Blocked people can’t enter the app.</small></span>
              </label>
              <label className="toggle-row guided-toggle">
                <input type="checkbox" checked={editingUser.guidedMode} onChange={(event) => setEditingUser({ ...editingUser, guidedMode: event.target.checked })} disabled={
                    editingUser.role === 'admin' ||
                    (!isSuperAdmin &&
                      normalizeEmail(editingUser.email) !== currentUserEmail)
                  }
                />
                <span><strong>Guided Mode</strong><small>Adds friendly reminders, locked scoring fields, and a final checklist.</small></span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={editingUser.permissions.canSubmitReviews}
                  onChange={(event) => setEditingUser({ ...editingUser, permissions: { ...editingUser.permissions, canSubmitReviews: event.target.checked } })}
                  disabled={editingUser.role === 'viewer'}
                />
                <span><strong>Can submit reviews</strong></span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={editingUser.permissions.canViewHistory}
                  onChange={(event) => setEditingUser({ ...editingUser, permissions: { ...editingUser.permissions, canViewHistory: event.target.checked } })}
                />
                <span><strong>Can view review history</strong></span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={editingUser.permissions.canEditAgentDetails}
                  onChange={(event) => setEditingUser({ ...editingUser, permissions: { ...editingUser.permissions, canEditAgentDetails: event.target.checked } })}
                />
                <span><strong>Can edit call and agent details</strong></span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={editingUser.permissions.canEditCriteriaSelections}
                  onChange={(event) => setEditingUser({ ...editingUser, permissions: { ...editingUser.permissions, canEditCriteriaSelections: event.target.checked } })}
                />
                <span><strong>Can select criteria statuses</strong></span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={editingUser.permissions.canEditCustomNotes}
                  onChange={(event) => setEditingUser({ ...editingUser, permissions: { ...editingUser.permissions, canEditCustomNotes: event.target.checked } })}
                />
                <span><strong>Can add custom notes</strong></span>
              </label>
            </div>

            {editingUser.email.toLowerCase() === 'shoultskelly22@gmail.com' && (
              <div className="kind-note">
                Kelly’s default setup uses Guided Mode. The app gives clear reminders without using negative or embarrassing language.
              </div>
            )}

            {isSuperAdmin &&
              !SUPER_ADMIN_EMAILS.has(normalizeEmail(editingUser.email)) && (
                <div className="kind-note">
                  Super Admin control is active. Junior or Barbara can change this person’s role,
                  permissions, Guided Mode, and active status, including regular administrators.
                </div>
              )}

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEditingUser(null)}>Cancel</button>
              <button type="button" className="primary-button" onClick={saveUser} disabled={busy}>{busy ? 'Saving…' : 'Save Person'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}