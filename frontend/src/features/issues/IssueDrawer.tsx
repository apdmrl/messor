import type { ReactElement, ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectMember } from '../projects/types'
import type { Issue, IssueActivity } from './types'
import { issueTypeLabel } from './issueLabels'
import { IssueActivityList } from './IssueActivityList'
import { IssueComments } from '../comments/IssueComments'
import './IssueDrawer.css'

type TabId = 'activity' | 'comments'

const TAB_LABELS: Record<TabId, string> = {
  activity: 'Aktivite',
  comments: 'Yorumlar',
}

interface IssueDrawerProps {
  issue: Issue
  currentUserId: string | null
  currentUserRole: 'PROJECT_LEAD' | 'MEMBER' | 'VIEWER'
  members: ProjectMember[]
  activity: IssueActivity[] | undefined
  activityLoading: boolean
  activityError: boolean
  statusLabel: (code: string) => string
  statusCodes: ReadonlySet<string>
  assigneeLabel: (id: string | null) => string
  /**
   * Blocks every close path (Escape, close button, backdrop) while a comment
   * mutation/confirmation or archive confirmation is pending, so an in-flight
   * write or an open confirmation is never discarded by an accidental close.
   */
  escapeBlocked: boolean
  onBusyChange: (busy: boolean) => void
  onClose: () => void
  closeButtonRef: RefObject<HTMLButtonElement | null>
  children?: ReactNode
}

/**
 * An accessible, route-backed issue drawer. Renders the controlled issue
 * heading plus two tabs (Aktivite / Yorumlar). The board behind stays visible.
 *
 * <p>Focus is trapped with Tab/Shift+Tab and Escape closes unless a comment
 * mutation or delete confirmation is pending. Both tab panels stay mounted (the
 * inactive one is {@code hidden}) so an unsaved comment draft survives tab
 * switches, while the comments query is only enabled while the comments tab is
 * active and the issue is valid.</p>
 */
export function IssueDrawer({
  issue,
  currentUserId,
  currentUserRole,
  members,
  activity,
  activityLoading,
  activityError,
  statusLabel,
  statusCodes,
  assigneeLabel,
  escapeBlocked,
  onBusyChange,
  onClose,
  closeButtonRef,
  children,
}: IssueDrawerProps): ReactElement {
  const [activeTab, setActiveTab] = useState<TabId>('activity')
  const rootRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    activity: null,
    comments: null,
  })

  const canComment = currentUserRole === 'PROJECT_LEAD' || currentUserRole === 'MEMBER'
  const isModerator = currentUserRole === 'PROJECT_LEAD'

  const getFocusable = useCallback((): HTMLElement[] => {
    const root = rootRef.current
    if (root === null) {
      return []
    }
    return Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (el) =>
        !el.hasAttribute('disabled') &&
        !el.hasAttribute('aria-hidden') &&
        el.closest('[hidden]') === null,
    )
  }, [])

  const trapFocus = useCallback(
    (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') {
        return
      }
      const focusable = getFocusable()
      if (focusable.length === 0) {
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (event.shiftKey) {
        if (active === null || active === first || !rootRef.current?.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last || active === null || !rootRef.current?.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    },
    [getFocusable],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (!escapeBlocked) {
          onClose()
        }
        return
      }
      trapFocus(event)
    },
    [escapeBlocked, onClose, trapFocus],
  )

  const handleBackdropClose = useCallback((): void => {
    if (!escapeBlocked) {
      onClose()
    }
  }, [escapeBlocked, onClose])

  const handleCloseButton = useCallback((): void => {
    if (!escapeBlocked) {
      onClose()
    }
  }, [escapeBlocked, onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [handleKeyDown])

  // Initial focus lands on the close button so a keyboard/screen-reader user
  // can immediately close the dialog.
  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [closeButtonRef])

  const onTabKeyDown = (event: React.KeyboardEvent): void => {
    const tabs: TabId[] = ['activity', 'comments']
    let next = activeTab
    if (event.key === 'ArrowRight') {
      next = tabs[(tabs.indexOf(activeTab) + 1) % tabs.length]
    } else if (event.key === 'ArrowLeft') {
      next = tabs[(tabs.indexOf(activeTab) - 1 + tabs.length) % tabs.length]
    } else if (event.key === 'Home') {
      next = tabs[0]
    } else if (event.key === 'End') {
      next = tabs[tabs.length - 1]
    } else {
      return
    }
    event.preventDefault()
    setActiveTab(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <div
      ref={rootRef}
      className="issue-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="issue-drawer-heading"
    >
      <div
        className="issue-drawer__backdrop"
        onClick={handleBackdropClose}
        aria-hidden="true"
      />

      <div className="issue-drawer__panel">
        <header className="issue-drawer__header">
          <div className="issue-drawer__heading-block">
            <h2
              id="issue-drawer-heading"
              className="issue-drawer__heading"
              tabIndex={-1}
            >
              {issue.issueKey}
            </h2>
            <p className="issue-drawer__title">{issue.title}</p>
          </div>
          <button
            type="button"
            ref={closeButtonRef}
            className="issue-drawer__close"
            aria-label="İş detay panelini kapat"
            onClick={handleCloseButton}
            disabled={escapeBlocked}
            aria-disabled={escapeBlocked}
          >
            Kapat
          </button>
        </header>

        <dl className="issue-drawer__meta">
          <div className="issue-drawer__meta-row">
            <dt>Tür</dt>
            <dd>{issueTypeLabel(issue.type)}</dd>
          </div>
          <div className="issue-drawer__meta-row">
            <dt>Durum</dt>
            <dd>{statusLabel(issue.statusCode)}</dd>
          </div>
          <div className="issue-drawer__meta-row">
            <dt>Atanan</dt>
            <dd>{assigneeLabel(issue.assigneeId)}</dd>
          </div>
        </dl>

        {issue.description !== null && issue.description !== '' && (
          <p className="issue-drawer__description">{issue.description}</p>
        )}

        {children}

        <div
          className="issue-drawer__tabs"
          role="tablist"
          aria-label="İş detayları"
          onKeyDown={onTabKeyDown}
        >
          {(Object.keys(TAB_LABELS) as TabId[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`issue-tab-${tab}`}
              ref={(element) => {
                tabRefs.current[tab] = element
              }}
              aria-selected={activeTab === tab}
              aria-controls={`issue-tabpanel-${tab}`}
              tabIndex={activeTab === tab ? 0 : -1}
              className={`issue-drawer__tab${activeTab === tab ? ' issue-drawer__tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id="issue-tabpanel-activity"
          aria-labelledby="issue-tab-activity"
          className="issue-drawer__tabpanel"
          hidden={activeTab !== 'activity'}
        >
          {activityLoading && (
            <p className="issue-drawer__status" role="status">
              Aktivite yükleniyor…
            </p>
          )}
          {!activityLoading && activityError && (
            <p className="issue-drawer__error" role="alert">
              Aktivite yüklenemedi. Lütfen tekrar deneyin.
            </p>
          )}
          {!activityLoading &&
            !activityError &&
            activity !== undefined &&
            activity.length === 0 && (
              <p className="issue-drawer__empty">Henüz aktivite yok.</p>
            )}
          {!activityLoading &&
            !activityError &&
            activity !== undefined &&
            activity.length > 0 && (
              <IssueActivityList
                activities={activity}
                statusLabel={statusLabel}
                statusCodes={statusCodes}
                assigneeLabel={assigneeLabel}
              />
            )}
        </div>

        <div
          role="tabpanel"
          id="issue-tabpanel-comments"
          aria-labelledby="issue-tab-comments"
          className="issue-drawer__tabpanel"
          hidden={activeTab !== 'comments'}
        >
          <IssueComments
            issueKey={issue.issueKey}
            currentUserId={currentUserId}
            canComment={canComment}
            isModerator={isModerator}
            members={members}
            enabled={activeTab === 'comments'}
            onBusyChange={onBusyChange}
          />
        </div>
      </div>
    </div>
  )
}
