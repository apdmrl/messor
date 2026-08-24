# Messor Burrow Instrument Product Design

## Status

Design specification for the first-release React product surface. Dark-first with a complete light-theme mapping. Optimized for 1280–1440px desktop workspaces with responsive fallback.

## Product posture

Messor is a portfolio-oriented project and issue-tracking application. The ant-colony metaphor is operational, not illustrative: hierarchy, tunnels, signals, workers, and bottlenecks are represented through context, workflow, presence, and state. No cartoon ants, decorative tunnels, particle effects, or persistent animation.

Visual posture: **Burrow Instrument** — earthy anthracite, structural dividers, compact tactile surfaces, and narrow amber signals.

## 1. Semantic visual tokens

Components consume semantic roles. Raw palette values are confined to theme definitions.

| Token | Dark | Light | Use |
|---|---|---|---|
| canvas | #151513 | #F5F3EE | Application background |
| surface-1 | #1D1C18 | #FFFFFF | Sidebar and primary panels |
| surface-2 | #25231E | #F0EEE8 | Cards, popovers, inputs |
| surface-3 | #302D26 | #E5E1D8 | Hover, selected, drag preview |
| surface-inverse | #F5F1E8 | #1B1A17 | Inverse emphasis |
| text-primary | #F5F1E8 | #1B1A17 | Titles and critical data |
| text-secondary | #C5BFB2 | #4C4942 | Supporting metadata |
| text-muted | #A19A8D | #68645C | Non-essential hints only |
| border-subtle | #3C3932 | #D6D1C7 | Dividers and card boundaries |
| border-strong | #625B4E | #989186 | Structural/focus-adjacent borders |
| signal-active | #D39A3E | #986316 | Active navigation, progress, primary action |
| signal-active-soft | #3B2D1B | #F4E6CC | Amber backgrounds |
| signal-danger | #E2765D | #A33E2D | Blockers and destructive actions |
| signal-success | #8FA27E | #557044 | Completed/healthy states |
| signal-info | #8FA8B2 | #426773 | Informational signals |
| signal-warning | #D7A85B | #8A5C16 | Bottlenecks and attention |

Primary text is used only on approved high-contrast surfaces. Essential metadata never uses muted text. Color is always paired with text, icon, position, or pattern. Priority and blocker semantics never depend on color alone.

Typography: Inter Variable or Geist Sans with system fallback; tabular numerals for IDs/counts/dates; page title 24/32 at 650 weight; section title 16/24 at 650; body 14/20 at 450; dense metadata 12/16 at 550; identifiers 11/16. Avoid long all-caps labels.

Geometry: strict 8px spacing scale (8, 16, 24, 32, 40, 48); 4px only for optical icon/hairline/progress alignment. Card radius 8px; controls 6px; overlays 10px; 1px borders; 40px default target and 32px compact minimum. Drag elevation is the only stronger shadow level.

Motion: hover changes surface only; press 100ms; panels 160ms ease-out; drag scale 1.02 and translateY(-2px). Respect prefers-reduced-motion by replacing transforms with border/opacity changes.

Implementation contract:

```css
:root {
  --messor-canvas: 245 243 238;
  --messor-surface-1: 255 255 255;
  --messor-surface-2: 240 238 232;
  --messor-text-primary: 27 26 23;
  --messor-text-secondary: 76 73 66;
  --messor-signal-active: 152 99 22;
}
[data-theme="dark"] {
  --messor-canvas: 21 21 19;
  --messor-surface-1: 29 28 24;
  --messor-surface-2: 37 35 30;
  --messor-text-primary: 245 241 232;
  --messor-text-secondary: 197 191 178;
  --messor-signal-active: 211 154 62;
}
```

Use semantic CSS variables with Tailwind utilities; never raw `amber-*`/`stone-*` classes inside components.

## 2. Shared interaction and accessibility

Every component defines default, hover, focus-visible, pressed, selected, disabled, loading, error, empty, restricted, and reduced-motion states. Focus is a visible 2px amber ring with 2px offset. Keyboard order follows visual order. Escape closes overlays and restores trigger focus. Board movement has a keyboard equivalent: Space lift, arrows choose destination, Space drop, Escape cancel.

Active navigation uses amber indicator, elevated surface, and `aria-current`. Priority uses text and icon (`P1 · Urgent`), blockers use explicit `Blocked`, and presence uses avatar, name, and status text. Live updates use polite aria-live and do not steal focus.

Desktop is primary. At narrower widths the sidebar becomes an icon rail/drawer, the board remains horizontally scrollable, issue detail becomes a full-screen drawer, and drag operations have a Move-to action. Interactive targets remain at least 40x40px.

Loading uses structural skeletons. Errors identify what failed, whether changes were preserved, and the next action. Failed mutations restore the previous state. Empty states explain why and provide one relevant action. Restricted states fail closed and never reveal object existence, IDs, or policy internals. Text remains understandable at 200% zoom; charts and progress indicators have numeric equivalents.

## 3. Navigation and information architecture

Authenticated shell: 40px top bar, 240px project rail, fluid content. Top bar contains Messor mark, workspace switcher, global search `/`, create, activity signals, help, and profile. Project rail contains My Work, Projects, current project links (Overview, Board, Issues, Activity, Members), and administration (workspace/project settings) when authorized. Collapsed rail is 56px.

Routes:

```text
/auth/login
/auth/session-expired
/app/my-work
/app/projects
/app/projects/:projectId/overview
/app/projects/:projectId/board
/app/projects/:projectId/issues
/app/projects/:projectId/issues/new
/app/projects/:projectId/issues/:issueId
/app/projects/:projectId/issues/:issueId/edit
/app/projects/:projectId/activity
/app/projects/:projectId/members
/app/projects/:projectId/settings
/app/workspace/settings
/app/workspace/members
```

Project links preserve project context in the route. Global create is project or issue; contextual create is issue; board create preselects the column state. Back navigation preserves filters and scroll where practical. Unauthorized entries are hidden when known, but direct routes still render neutral restricted states.

## 4. Shared page and state patterns

Standard frame: context label, title/actions, description/counts, toolbar, content. Desktop horizontal padding 32px; lists/settings max-width 1200px; boards are full-width.

Loading: title/action skeleton, toolbar skeleton, list rows or board/card skeletons. Empty: concise reason, geometric/icon treatment, one primary action, optional explanation. Error: local boundary when possible; full boundary only when route data cannot render; no stack/session/database details. Not-found is used only when routing fails before authorization. Restricted is intentionally indistinguishable from inaccessible/deleted resources.

Mutations preserve input, show pending on the affected control, and restore state on failure. URL query parameters represent shareable filters; local display preferences may use local storage, never auth data. Dirty forms warn before navigation. Server validation maps to fields and a top summary.

## 5. Project and board surfaces

Project overview: project header (status, owner, presence, description, Open board/New issue), operational summary (open, in progress, blocked, completed), work snapshot (recent activity, bottlenecks, assigned-to-me). Summary cards are links, not decoration.

Board desktop frame: project rail 240px, board canvas, optional detail rail 320px. Board canvas uses `grid-template-columns: repeat(3, minmax(280px, 1fr)); gap: 16px; padding: 24px`. Three workflow columns are configurable state labels; default conceptual states are Queue, Active, Done.

Column: state/count/WIP header, add/sort/menu toolbar, cards with 8px gaps, reachable Add issue footer. Surface-1 column on canvas. Active column has amber top rule. Task card hierarchy: ID/type/priority, title max two lines, labels, subtask progress, assignee avatars, overflow. Full card opens detail; nested controls stop propagation. Blocked card uses danger leading edge plus `Blocked` label.

Dragging scales 1.02, increases shadow, leaves dashed placeholder, and exposes amber insertion line. Drop is optimistic with pending marker; rejection restores original position and explains why. Keyboard movement matches pointer movement.

Empty column: “No work in Active” plus explanation and Add issue; remains a valid visible drop target. Overburdened column shows count versus WIP threshold, amber warning strip, “This tunnel is carrying more work than its limit,” and Review bottleneck. Severe thresholds escalate to danger without blocking work.

Detail rail previews ID/title/state/priority, assignees/labels, description, subtasks, latest comments/activity, and Open full detail. Escape closes it.

## 6. Issues and collaboration

Issue detail uses fluid main content (readable width ~720px) and sticky 280–320px context panel. Header includes ID/type/title/state/overflow. Context fields: state, priority, assignee, labels, project. Title supports explicit in-place save/cancel. Creation can originate globally, project, board column, or My Work; board entry preselects state. Required fields are project/title/type/state. Failed submit preserves input.

Comments are chronological plain-text-safe collaboration entries with avatar, actor, timestamp, edited state, body, and authorized actions. Empty comments provide Add the first comment. Pending/offline comments preserve drafts. Deleted comments use tombstones where audit continuity requires.

Activity is separate from comments. Events include actor, action, object, timestamp, and safe before/after values. Filters: event type, actor, date. Signals: mentioned, blocked, changed since last view, unread, due soon. Signals are sparse and text-supported.

Edge states: offline submit preserves draft; concurrent change offers reload latest and preserves unsaved text where feasible; deleted issue renders tombstone; permission loss disables mutations while retaining readable content.

## 7. My Work and filtering

My Work answers what needs attention, what is blocked, what changed, and what can finish next. Summary links: Assigned to me, Due/urgent, Blocked, Recently updated. Default groups: Blocked, In progress, Queue, Completed recently. Rows show project, ID/title, state, priority, due information, assignee, updated time. Detail opens a drawer while preserving list/filter state.

Filters: project, state, priority, assignee, labels, updated date, blocked. Filters become removable chips, persist in URL, and show Clear all. Presets are Blocked, Due soon, Recently changed, All assigned; do not add a configurable saved-search subsystem unless already supported.

Optional desktop workload rail (280px) shows assigned/open/blocked counts, priority distribution, projects with active work, and recent affecting activity. Use numeric horizontal bars, not pie charts. Team workload, if authorized, shows member active/blocked/completed counts and never infers unavailable data.

## 8. Administration

Settings shell: 224px settings navigation and max-width 760px content. Sections: General, Members and roles, Projects, Appearance, Security/session information where supported. Workspace general edits name/description/identifier with explicit confirmation for identifier changes. Appearance maps theme to semantic tokens. Project list shows name/status/owner/member count/activity. Project settings cover general, workflow states, labels/priorities, members, and danger zone.

Workflow state reordering has keyboard controls. Deleting a state requires choosing a destination and showing affected issue counts. Labels/priorities remain text-first and contrast-safe. Archive/delete/project state migration are separated from routine controls and require consequence summary plus typed confirmation or project-name selection.

## 9. Membership and authorization

Member table columns: member, role, project access, status, last activity, actions. Search/filter remain above. Current user is labeled You. Roles: Owner, Admin, Member, Viewer; labels are product terms, not backend policy names. Project member drawer supports adding existing workspace members, role change, remove access, and effective-access explanation.

Negative matrix:

| Action | Viewer | Member | Admin | Owner |
|---|---:|---:|---:|---:|
| View accessible project | Read | Read | Read | Read |
| Create issue | No | Yes | Yes | Yes |
| Edit own issue | No | Yes | Yes | Yes |
| Edit any issue | No | Policy | Yes | Yes |
| Move board issue | No | Yes | Yes | Yes |
| Comment | No | Yes | Yes | Yes |
| Project settings | No | No | Yes | Yes |
| Project members | No | No | Yes | Yes |
| Workspace members | No | No | Policy | Yes |
| Delete project | No | No | No/Policy | Yes |

Backend object-level authorization is authoritative. UI hides known-inaccessible navigation, renders read-only when read permission exists, and uses neutral restricted states when access is unavailable. Mixed-access lists omit inaccessible resources. Membership/role changes show actor, target, action, and timestamp after success. No invitations, password reset, attachments, notifications, sprints, epics, subtasks, or microservices are introduced.

## 10. Developer structures

Preferred primitives: `AuthenticatedShell`, `WorkspaceSwitcher`, `ProjectRail`, `PageHeader`, `FilterToolbar`, `StateBoundary`, `IssueCard`, `BoardColumn`, `IssueDetailDrawer`, `ActivityFeed`, `MemberTable`, `SettingsNav`, `PermissionGate` (UX only), and semantic token CSS variables. Keep domain features organized under existing frontend feature folders. Use CSS Grid for shell/board and Flexbox for headers, toolbars, and card metadata. Use TanStack Query for server state and local React state for view-only interaction. Do not expose JPA entities or security values.

## 11. Verification requirements

Visual verification must exercise authenticated shell, dark/light theme mapping, board drag and keyboard movement, empty/overburdened columns, issue create/edit/comment, filters and URL persistence, member role changes, restricted routes, session expiry, loading/error states, and 200% zoom/focus navigation. Tests must cover authorization negatives, validation, mutation rollback, and PostgreSQL-backed behavior where backend contracts change.
