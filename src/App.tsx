import { useCallback, useEffect, useRef, useState } from 'react'
import { GoogleSignIn } from './components/GoogleSignIn'
import { Shell, type AppPage } from './components/Shell'
import { DEFAULT_SETTINGS } from './data/defaults'
import { bootstrap, createQaBackup, fetchReviews, fetchWatchListAgents, getPresence, markReviewEmailSent, removePresence, restoreLatestQaBackup, saveReview, saveSettings, saveUser, saveWatchListAgent, seedStarterWatchList, setUserBlocked, setWatchListAgentStatus, updatePresence, type PresenceUser } from './lib/api'
import { signOutFirebase, waitForFirebaseSession } from './lib/auth'
import { AdminPage } from './pages/AdminPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { importLegacyWorkbookToFirebase } from './lib/importLegacyWorkbook'
import { DashboardPage } from './pages/DashboardPage'
import { ReviewPage } from './pages/ReviewPage'
import { ReviewsPage } from './pages/ReviewsPage'
import { WatchListPage } from './pages/WatchListPage'
import type { AppSettings, AuthSession, QaUser, ReviewDraft, ReviewRecord, WatchListAgent, WatchListAgentInput, WatchListStatus } from './types'

interface ToastState {
  type: 'success' | 'error' | 'info'
  message: string
}

const LOADING_MESSAGES = [
  'Finding the agent who said “please hold” and disappeared…',
  'Checking whether the Call ID belongs to this exact call…',
  'Making sure Kelly doesn’t have to memorize 400 QA rules…',
  'One click at a time... Kelly’s got this! 👍',
  'Waiting for Junior the QA Wizard to finish casting the perfect-score spell… 🧙‍♂️',
'Junior is working his spreadsheet magic—please do not disturb the wizard… ✨',
  'Making sure Barbara doesn’t have to send another reminder email… 📧',
  'Counting how many times the guest repeated the confirmation number…',
  'Making sure nobody promised a refund without checking the matrix…',
  'Checking if the matrix has another surprise update…',
  'Checking Firebase before another review lands…',
  'Making sure Kelly doesn’t have to memorize 400 QA rules…',
  'Guided Mode is helping Kelly avoid accidental QA adventures…',
  'Looking for the agent who forgot to document the notes…',
  'Checking whether the guest was placed on hold without an update…',
  'Verifying whether the agent remembered the closing recap…',
  'Searching for mysterious dead air in the call…',
  'Making sure “I understand” was followed by an actual solution…',
  'Checking whether the correct hotel was booked this time…',
  'Reviewing whether the guest’s email was verified correctly…',
  'Investigating why the call lasted 37 minutes…',
  'Checking whether the agent followed the process or invented one…',
  'Preparing the QA score while protecting everyone’s feelings…',
  'Connecting securely to Firebase before another call needs reviewing…',
  'Loading the dashboard while pretending everything is under control… 😄'
]


const PRESENCE_HEARTBEAT_MS = 20_000
const PRESENCE_REFRESH_MS = 20_000

function createPresenceSessionId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }

  return `qa-presence-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`
}

function getPresencePageLabel(page: AppPage): string {
  const labels: Record<AppPage, string> = {
    dashboard: 'Dashboard',
    review: 'New Review',
    sales: 'Sales QA',
    watchlist: 'Watch List',
    history: 'Review History',
    analytics: 'Agent Performance',
    admin: 'Admin Control',
  }

  return labels[page]
}

function LoadingScreen({ percent = 40 }: { percent?: number }) {
  const [messageIndex, setMessageIndex] = useState(0)

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setMessageIndex((currentIndex) => (currentIndex + 1) % LOADING_MESSAGES.length)
    }, 4000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  return (
    <main className="loading-screen">
      <div className="loading-content">
        <div className="spinner" aria-hidden="true" />

        <h1>Loading QA Control Center…</h1>
        <div className="operation-progress loading-progress"><div className="operation-progress-copy"><span>Connecting to Firebase</span><strong>{percent}%</strong></div><div className="operation-progress-track"><div className="operation-progress-fill" style={{ width: `${percent}%` }} /></div></div>

        <p
          key={messageIndex}
          className="loading-funny-message"
          aria-live="polite"
        >
          {LOADING_MESSAGES[messageIndex]}
        </p>

        <span className="loading-message-counter">
          QA check {messageIndex + 1} of {LOADING_MESSAGES.length}
        </span>
      </div>
    </main>
  )
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [currentUser, setCurrentUser] = useState<QaUser | null>(null)
  const [users, setUsers] = useState<QaUser[]>([])
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [reviews, setReviews] = useState<ReviewRecord[]>([])
  const [watchListAgents, setWatchListAgents] = useState<WatchListAgent[]>([])
  const [activePage, setActivePage] = useState<AppPage>('dashboard')
  const [performanceAgent, setPerformanceAgent] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingPercent, setLoadingPercent] = useState(10)
  const [operationProgress, setOperationProgress] = useState<{ percent: number; label: string } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [toast, setToast] = useState<ToastState | null>(null)
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([])
  const presenceSessionIdRef = useRef(createPresenceSessionId())
  const activePageRef = useRef<AppPage>('dashboard')

  const showToast = useCallback((message: string, type: ToastState['type'] = 'info') => {
    setToast({ message, type })
    window.setTimeout(() => setToast(null), 5000)
  }, [])

  const handleNavigate = useCallback((page: AppPage) => {
    setActivePage(page)
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    })
  }, [])

  useEffect(() => {
    let disposed = false
    void waitForFirebaseSession()
      .then((existingSession) => {
        if (disposed) return
        setSession(existingSession)
        setAuthReady(true)
        if (!existingSession) setLoading(false)
      })
      .catch((error) => {
        if (disposed) return
        setAuthError(error instanceof Error ? error.message : 'Firebase sign-in could not be restored.')
        setAuthReady(true)
        setLoading(false)
      })
    return () => { disposed = true }
  }, [])

  const loadApp = useCallback(async (activeSession: AuthSession) => {
    setLoading(true)
    setLoadingPercent(18)
    setAuthError('')
    try {
      const boot = await bootstrap(activeSession)
      setLoadingPercent(55)
      const reviewRows = await fetchReviews(activeSession)
      setLoadingPercent(72)
      if (!boot.success || !boot.user) throw new Error(boot.message || 'Your account could not be loaded.')

      let watchRows: WatchListAgent[] = []
      try {
        watchRows = await fetchWatchListAgents(activeSession)
        if (watchRows.length === 0 && (boot.user.email === 'infojr.83@gmail.com' || boot.user.email === 'barbara.kalchik8reserve@gmail.com')) {
          try {
            const seeded = await seedStarterWatchList(activeSession)
            if (seeded) watchRows = await fetchWatchListAgents(activeSession)
          } catch (error) {
            console.warn('Starter Watch List import could not run.', error)
          }
        }
      } catch (error) {
        // Keep the existing QA app usable even if the new Watch List rules have not been deployed yet.
        console.warn('Watch List could not be loaded. Existing QA features will continue to work.', error)
      }
      setLoadingPercent(90)
      if (!boot.user.active) throw new Error('Your QA app account is blocked. Contact Junior or Barbara.')

      setCurrentUser(boot.user)
      setUsers(boot.users || [boot.user])
      setSettings(boot.settings || DEFAULT_SETTINGS)
      setReviews(reviewRows)
      setWatchListAgents(watchRows)
      setLoadingPercent(100)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The app could not be loaded.'
      setAuthError(message)
      setCurrentUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authReady) return
    if (session) void loadApp(session)
  }, [authReady, loadApp, session])

  useEffect(() => {
    activePageRef.current = activePage

    if (!session || !currentUser) return

    void updatePresence(
      session,
      getPresencePageLabel(activePage),
      presenceSessionIdRef.current,
    )
      .then(() => getPresence(session))
      .then((liveUsers) => setPresenceUsers(liveUsers))
      .catch((error) => {
        console.warn(
          'Live presence page update failed.',
          error,
        )
      })
  }, [activePage, session, currentUser])

  useEffect(() => {
    if (!session || !currentUser) return

    let disposed = false
    let heartbeatInProgress = false

    const refreshPresence = async () => {
      if (heartbeatInProgress || disposed) return
      heartbeatInProgress = true

      try {
        await updatePresence(
          session,
          getPresencePageLabel(activePageRef.current),
          presenceSessionIdRef.current,
        )

        const liveUsers = await getPresence(session)
        if (!disposed) setPresenceUsers(liveUsers)
      } catch (error) {
        // Presence must never interrupt reviews, reports, or saving.
        console.warn('Live presence heartbeat failed.', error)
      } finally {
        heartbeatInProgress = false
      }
    }

    void refreshPresence()

    const heartbeatId = window.setInterval(
      () => void refreshPresence(),
      PRESENCE_HEARTBEAT_MS,
    )

    const refreshId = window.setInterval(async () => {
      try {
        const liveUsers = await getPresence(session)
        if (!disposed) setPresenceUsers(liveUsers)
      } catch (error) {
        console.warn('Live presence refresh failed.', error)
      }
    }, PRESENCE_REFRESH_MS)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshPresence()
      }
    }

    const handleFocus = () => {
      void refreshPresence()
    }

    document.addEventListener(
      'visibilitychange',
      handleVisibilityChange,
    )
    window.addEventListener('focus', handleFocus)

    return () => {
      disposed = true
      window.clearInterval(heartbeatId)
      window.clearInterval(refreshId)
      document.removeEventListener(
        'visibilitychange',
        handleVisibilityChange,
      )
      window.removeEventListener('focus', handleFocus)
    }
  }, [session, currentUser])

  const handleLogin = (nextSession: AuthSession) => {
    setSession(nextSession)
    setAuthReady(true)
  }

  const handleLogout = () => {
    const activeSession = session
    const presenceSessionId = presenceSessionIdRef.current

    if (activeSession) {
      void removePresence(
        activeSession,
        presenceSessionId,
      ).catch((error) => {
        console.warn('Presence logout cleanup failed.', error)
      })
    }

    void signOutFirebase().catch((error) => console.warn('Firebase sign-out failed.', error))
    setSession(null)
    setCurrentUser(null)
    setUsers([])
    setReviews([])
    setWatchListAgents([])
    setPresenceUsers([])
    setActivePage('dashboard')
    activePageRef.current = 'dashboard'
    presenceSessionIdRef.current = createPresenceSessionId()
  }

  const refreshReviews = async (force = true) => {
    if (!session) return
    setRefreshing(true)
    setOperationProgress({ percent: 15, label: 'Refreshing reviews from Firebase' })
    try {
      const freshReviews = await fetchReviews(session, force)
      setReviews(freshReviews)
      try {
        setWatchListAgents(await fetchWatchListAgents(session))
      } catch (error) {
        console.warn('Watch List refresh failed without interrupting review refresh.', error)
      }
      setOperationProgress({ percent: 100, label: 'Firebase reviews and Watch List refreshed' })
      showToast('Review and Watch List data refreshed from Firebase.', 'success')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Refresh failed.', 'error')
    } finally {
      setRefreshing(false)
      window.setTimeout(() => setOperationProgress(null), 400)
    }
  }

  const handleSaveReview = async (review: ReviewDraft) => {
    if (!session) return
    setBusy(true)
    setOperationProgress({ percent: 20, label: 'Validating and saving review' })
    try {
      const response = await saveReview(session, review)
      setOperationProgress({ percent: 70, label: 'Review saved — refreshing history' })
      if (!response.success) throw new Error(response.message || 'The review was not saved.')
      showToast(response.message || 'Review saved to Firebase.', 'success')
      await refreshReviews(true)
      handleNavigate('dashboard')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The review was not saved.'
      showToast(message, 'error')
      throw caught
    } finally {
      setBusy(false)
      window.setTimeout(() => setOperationProgress(null), 500)
    }
  }

  const handleSaveUser = async (user: QaUser) => {
    if (!session) return
    setBusy(true)
    setOperationProgress({ percent: 25, label: 'Saving user permissions' })
    try {
      const response = await saveUser(session, user)
      setOperationProgress({ percent: 100, label: 'Permissions saved' })
      if (!response.success) throw new Error(response.message || 'The person was not saved.')
      const saved = response.user || user
      setUsers((current) => {
        const exists = current.some((item) => item.email.toLowerCase() === saved.email.toLowerCase())
        if (!exists) return [...current, saved]
        return current.map((item) => item.email.toLowerCase() === saved.email.toLowerCase() ? saved : item)
      })
      showToast(response.message || `${saved.displayName} was saved.`, 'success')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'The person was not saved.', 'error')
      throw caught
    } finally {
      setBusy(false)
      window.setTimeout(() => setOperationProgress(null), 450)
    }
  }

  const handleSetBlocked = async (email: string, blocked: boolean) => {
    if (!session) return
    const action = blocked ? 'block' : 'unblock'
    if (!window.confirm(`Are you sure you want to ${action} this account?`)) return
    setBusy(true)
    setOperationProgress({ percent: 25, label: `${blocked ? 'Blocking' : 'Unblocking'} account` })
    try {
      const response = await setUserBlocked(session, email, blocked)
      setOperationProgress({ percent: 100, label: 'Account access updated' })
      if (!response.success) throw new Error(response.message || `The account could not be ${blocked ? 'blocked' : 'unblocked'}.`)
      setUsers((current) => current.map((item) => item.email.toLowerCase() === email.toLowerCase() ? { ...item, active: !blocked } : item))
      showToast(response.message || `Account ${blocked ? 'blocked' : 'unblocked'}.`, 'success')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'The account status was not changed.', 'error')
    } finally {
      setBusy(false)
      window.setTimeout(() => setOperationProgress(null), 450)
    }
  }

  const handleSaveSettings = async (nextSettings: AppSettings) => {
    if (!session) return
    setBusy(true)
    setOperationProgress({ percent: 25, label: 'Saving QA settings' })
    try {
      const response = await saveSettings(session, nextSettings)
      setOperationProgress({ percent: 100, label: 'QA settings saved' })
      if (!response.success) throw new Error(response.message || 'Settings were not saved.')
      setSettings(response.settings || nextSettings)
      showToast(response.message || 'QA settings were saved.', 'success')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Settings were not saved.', 'error')
      throw caught
    } finally {
      setBusy(false)
      window.setTimeout(() => setOperationProgress(null), 450)
    }
  }


  const handleMarkEmailSent = async (review: ReviewRecord, sent: boolean) => {
    if (!session) return
    setOperationProgress({ percent: 30, label: 'Updating email status' })
    const response = await markReviewEmailSent(session, review, sent)
    setOperationProgress({ percent: 100, label: 'Email status updated' })
    if (!response.success) throw new Error(response.message || 'Email status was not saved.')
    setReviews((current) => current.map((item) => item.rowNumber === review.rowNumber ? { ...item, emailSent: sent, emailSentAt: sent ? new Date().toISOString() : '', emailSentBy: sent ? currentUser?.displayName || '' : '' } : item))
    showToast(response.message || `Email marked ${sent ? 'sent' : 'not sent'}.`, 'success')
    window.setTimeout(() => setOperationProgress(null), 450)
  }

  

  const handleImportLegacyWorkbook = async (file: File) => {
    if (!session) return
    setBusy(true)
    try {
      const result = await importLegacyWorkbookToFirebase(file, session, (percent, label) => {
        setOperationProgress({ percent, label })
      })
      const boot = await bootstrap(session)
      setCurrentUser(boot.user)
      setUsers(boot.users || [boot.user])
      setSettings(boot.settings || DEFAULT_SETTINGS)
      setReviews(await fetchReviews(session, true))
      showToast(`Migration complete: ${result.reviews} reviews and ${result.users} users imported.`, 'success')
      return result
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Legacy migration failed.'
      showToast(message, 'error')
      throw caught
    } finally {
      setBusy(false)
      window.setTimeout(() => setOperationProgress(null), 800)
    }
  }

  const handleCreateBackup = async () => {
    if (!session) return
    const response = await createQaBackup(session)
    if (!response.success) throw new Error(response.message || 'Backup failed.')
    showToast(response.message || 'Backup created.', 'success')
  }

  const refreshWatchList = async () => {
    if (!session) return
    try {
      setWatchListAgents(await fetchWatchListAgents(session))
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Watch List refresh failed.', 'error')
    }
  }

  const handleSaveWatchListAgent = async (input: WatchListAgentInput, id?: string) => {
    if (!session) return
    setBusy(true)
    try {
      await saveWatchListAgent(session, input, id)
      await refreshWatchList()
      showToast(id ? 'Watch List agent updated.' : 'Agent added to the Watch List.', 'success')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The Watch List agent could not be saved.'
      showToast(message, 'error')
      throw caught
    } finally {
      setBusy(false)
    }
  }

  const handleWatchListStatus = async (agent: WatchListAgent, status: WatchListStatus) => {
    if (!session) return
    setBusy(true)
    try {
      await setWatchListAgentStatus(session, agent, status)
      await refreshWatchList()
      showToast(status === 'Active' ? `${agent.agentName} restored to the Watch List.` : `${agent.agentName} moved to Watch List history.`, 'success')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Watch List status could not be changed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleRestoreLatestBackup = async () => {
    if (!session) return
    const response = await restoreLatestQaBackup(session)
    showToast(response.message || 'Use Admin Control to import a legacy Excel workbook.', response.success ? 'success' : 'info')
  }

  if (!authReady || (session && loading)) {
    return <LoadingScreen percent={loadingPercent} />
  }

  if (!session || !currentUser) {
    return (
      <>
        <GoogleSignIn onSuccess={handleLogin} />
        {authError && <div className="floating-auth-error">{authError}</div>}
      </>
    )
  }

  const activeEvaluators = users.filter((user) => user.active && user.role !== 'viewer')

  return (
    <Shell
      user={currentUser}
      activePage={activePage}
      onNavigate={handleNavigate}
      onLogout={handleLogout}
      reviews={reviews}
      presenceUsers={presenceUsers}
      teamUsers={users}
    >
      {activePage === 'dashboard' && (
        <DashboardPage
          user={currentUser}
          users={users}
          reviews={reviews}
          watchListAgents={watchListAgents}
          onOpenWatchList={() => handleNavigate('watchlist')}
          onNewReview={() => handleNavigate('review')}
          onRefresh={() => void refreshReviews(true)}
          refreshing={refreshing}
          onCreateBackup={handleCreateBackup}
          onRestoreLatestBackup={handleRestoreLatestBackup}
        />
      )}

      {activePage === 'review' && (
        <ReviewPage
          user={currentUser}
          settings={settings}
          evaluators={activeEvaluators}
          watchListAgents={watchListAgents}
          onSave={handleSaveReview}
          saving={busy}
        />
      )}

      {activePage === 'sales' && (
        <ReviewPage
          user={currentUser}
          settings={settings}
          evaluators={activeEvaluators}
          watchListAgents={watchListAgents}
          onSave={handleSaveReview}
          saving={busy}
          initialQaType="Sales"
        />
      )}

      {activePage === 'watchlist' && (
        <WatchListPage
          user={currentUser}
          agents={watchListAgents}
          reviews={reviews}
          onSave={handleSaveWatchListAgent}
          onSetStatus={handleWatchListStatus}
          onRefresh={refreshWatchList}
          busy={busy}
          onOpenPerformance={(agentName) => { setPerformanceAgent(agentName); handleNavigate('analytics') }}
        />
      )}

      {activePage === 'history' && (
        <ReviewsPage
  user={currentUser}
  reviews={reviews}
  onRefresh={() => void refreshReviews(true)}
  refreshing={refreshing}
  onMarkEmailSent={handleMarkEmailSent}
/>
      )}

      {activePage === 'analytics' && currentUser.role === 'admin' && (
        <AnalyticsPage
          user={currentUser}
          reviews={reviews}
          watchListAgents={watchListAgents}
          initialAgent={performanceAgent}
        />
      )}

      {activePage === 'admin' && currentUser.role === 'admin' && (
        <AdminPage
          currentUser={currentUser}
          users={users}
          settings={settings}
          onSaveUser={handleSaveUser}
          onSetBlocked={handleSetBlocked}
          onSaveSettings={handleSaveSettings}
          onImportLegacyWorkbook={handleImportLegacyWorkbook}
          busy={busy}
        />
      )}

      {operationProgress && (
        <div className="global-progress-card" aria-live="polite">
          <div className="operation-progress-copy"><span>{operationProgress.label}</span><strong>{operationProgress.percent}%</strong></div>
          <div className="operation-progress-track"><div className="operation-progress-fill" style={{ width: `${operationProgress.percent}%` }} /></div>
        </div>
      )}
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </Shell>
  )
}