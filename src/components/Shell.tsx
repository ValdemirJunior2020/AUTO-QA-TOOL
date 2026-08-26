import type { ReactNode } from 'react'
import type { PresenceUser } from '../lib/api'
import type { QaUser, ReviewRecord } from '../types'
import { WeatherWidget } from './WeatherWidget'
import { DailyPupWidget } from './DailyPupWidget'
import FunFactWidget from './FunFactWidget'
import { QaWordHelper } from './QaWordHelper'
import { SUPER_ADMIN_EMAILS, normalizeEmail } from '../lib/firebase'

export type AppPage =
  | 'dashboard'
  | 'review'
  | 'sales'
  | 'watchlist'
  | 'history'
  | 'analytics'
  | 'admin'

interface ShellProps {
  user: QaUser
  activePage: AppPage
  onNavigate: (page: AppPage) => void
  onLogout: () => void
  children: ReactNode
  reviews?: ReviewRecord[]
  presenceUsers?: PresenceUser[]
  teamUsers?: QaUser[]
}

function pageLabel(page: string): string {
  const normalized = page.toLowerCase()

  if (normalized === 'dashboard') return 'Dashboard'
  if (normalized === 'review') return 'New Review'
  if (normalized === 'sales') return 'Sales QA'
  if (normalized === 'watchlist') return 'Watch List'
  if (normalized === 'history') return 'Review History'
  if (normalized === 'analytics') return 'Agent Performance'
  if (normalized === 'admin') return 'Admin Control'

  return page || 'QA Control Center'
}

function roleLabel(user: {
  role: string
  guidedMode?: boolean
  email?: string
}): string {
  if (user.role === 'admin' && SUPER_ADMIN_EMAILS.has(normalizeEmail(user.email))) return 'Super Admin'
  if (user.role === 'admin') return 'Administrator'
  if (user.role === 'viewer') return 'Viewer'
  if (user.guidedMode) return 'Guided Evaluator'
  return 'Evaluator'
}

function formatLastSeen(lastSeen: string): string {
  if (!lastSeen) return 'Not seen yet'

  const time = new Date(lastSeen).getTime()

  if (!Number.isFinite(time)) {
    return 'Recently active'
  }

  const differenceSeconds = Math.max(
    0,
    Math.floor((Date.now() - time) / 1000),
  )

  if (differenceSeconds < 60) {
    return 'Just now'
  }

  const minutes = Math.floor(differenceSeconds / 60)

  if (minutes < 60) {
    return `${minutes} min${minutes === 1 ? '' : 's'} ago`
  }

  const hours = Math.floor(minutes / 60)

  if (hours < 24) {
    return `${hours} hr${hours === 1 ? '' : 's'} ago`
  }

  const days = Math.floor(hours / 24)

  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function Shell({
  user,
  activePage,
  onNavigate,
  onLogout,
  children,
  reviews = [],
  presenceUsers = [],
  teamUsers = [],
}: ShellProps) {
  void reviews

  const items: Array<{
    id: AppPage
    label: string
    adminOnly?: boolean
  }> = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'review', label: 'New Review' },
    { id: 'sales', label: '💼 Sales QA' },
    { id: 'watchlist', label: '👁 Watch List' },
    { id: 'history', label: 'Review History' },
    { id: 'analytics', label: '📈 Agent Performance', adminOnly: true },
    {
      id: 'admin',
      label: 'Admin Control',
      adminOnly: true,
    },
  ]

  const currentPageTitle =
    items.find((item) => item.id === activePage)?.label ??
    'QA Control Center'

  const presenceByEmail = new Map(
    presenceUsers.map((presence) => [
      presence.email.toLowerCase(),
      presence,
    ]),
  )

  const liveTeam = teamUsers
    .filter((teamUser) => teamUser.active)
    .map((teamUser) => {
      const presence = presenceByEmail.get(
        teamUser.email.toLowerCase(),
      )

      return {
        email: teamUser.email,
        displayName: teamUser.displayName,
        role: teamUser.role,
        guidedMode: teamUser.guidedMode,
        currentPage: presence?.currentPage || '',
        lastSeen: presence?.lastSeen || '',
        online: Boolean(presence?.online),
      }
    })
    .sort((left, right) => {
      if (left.online !== right.online) {
        return left.online ? -1 : 1
      }

      return left.displayName.localeCompare(
        right.displayName,
      )
    })

  const onlineCount = liveTeam.filter(
    (teamUser) => teamUser.online,
  ).length

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark small">
            QA
          </div>

          <div>
            <strong>QA Control Center</strong>
            <span>HotelPlanner</span>
          </div>
        </div>

        <div className="sidebar-page-title">
          <p>Quality Assurance</p>
          <h2>{currentPageTitle}</h2>
        </div>

        <nav
          className="sidebar-nav"
          aria-label="Main navigation"
        >
          {items
            .filter(
              (item) =>
                !item.adminOnly ||
                user.role === 'admin',
            )
            .map((item) => (
              <button
                key={item.id}
                type="button"
                className={
                  activePage === item.id
                    ? 'active'
                    : ''
                }
                onClick={() => onNavigate(item.id)}
              >
                {item.label}
              </button>
            ))}

          <a
            href="https://agent-picks.netlify.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="sidebar-tool-button agent-picks-button"
          >
            <span>Agent&apos;s Pick Page</span>

            <span
              className="external-arrow"
              aria-hidden="true"
            >
              ↗
            </span>
          </a>

          <button
            type="button"
            className="sidebar-tool-button download-excel-button"
            onClick={() => onNavigate('history')}
          >
            <span>Firebase Excel Downloads</span>

            <span
              className="external-arrow"
              aria-hidden="true"
            >
              ↓
            </span>
          </button>

          <QaWordHelper />
        </nav>

        <section
          className="live-team-panel"
          aria-label="Live team presence"
        >
          <div className="live-team-heading">
            <div>
              <span className="live-team-kicker">
                Constant monitoring
              </span>

              <strong>Live Team</strong>
            </div>

            <span className="live-team-count">
              {onlineCount} online
            </span>
          </div>

          <div className="live-team-list">
            {liveTeam.length === 0 ? (
              <p className="live-team-empty">
                Waiting for team presence…
              </p>
            ) : (
              liveTeam.map((teamUser) => (
                <article
                  className={`live-team-user ${
                    teamUser.online
                      ? 'is-online'
                      : 'is-offline'
                  }`}
                  key={teamUser.email}
                >
                  <span
                    className={`live-presence-dot ${
                      teamUser.online
                        ? 'live-presence-dot--online'
                        : 'live-presence-dot--offline'
                    }`}
                    aria-hidden="true"
                  />

                  <div className="live-team-user-copy">
                    <strong>
                      {teamUser.displayName}
                    </strong>

                    <span>
                      {teamUser.online
                        ? pageLabel(
                            teamUser.currentPage,
                          )
                        : roleLabel(teamUser)}
                    </span>
                  </div>

                  <div className="live-team-status-copy">
                    <strong
                      className={
                        teamUser.online
                          ? 'live-presence-status--online'
                          : 'live-presence-status--offline'
                      }
                    >
                      {teamUser.online
                        ? 'ONLINE'
                        : 'OFFLINE'}
                    </strong>

                    <span>
                      {teamUser.online
                        ? 'Live now'
                        : formatLastSeen(
                            teamUser.lastSeen,
                          )}
                    </span>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <div className="sidebar-user">
          <div className="avatar">
            {user.displayName
              .slice(0, 1)
              .toUpperCase()}
          </div>

          <div className="sidebar-user-copy">
            <strong>{user.displayName}</strong>

            <span>
              {user.role === 'admin'
                ? (SUPER_ADMIN_EMAILS.has(normalizeEmail(user.email)) ? 'Super Admin' : 'Administrator')
                : user.guidedMode
                  ? 'Evaluator · Guided Mode'
                  : 'Evaluator'}
            </span>
          </div>

          <button
            type="button"
            className="text-button"
            onClick={onLogout}
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-center-stack">
            <div className="topbar-center-fun">
              <WeatherWidget />
              <DailyPupWidget />
            </div>

            <FunFactWidget />
          </div>

          <div className="topbar-badges">
            {user.guidedMode && (
              <span className="badge guided">
                Guided Mode
              </span>
            )}

            <span
              className={`badge ${
                user.active
                  ? 'active'
                  : 'blocked'
              }`}
            >
              {user.active
                ? 'Active'
                : 'Blocked'}
            </span>
          </div>
        </header>

        <main className="content-area">
          {children}
        </main>

      </div>
    </div>
  )
}