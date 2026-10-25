<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Emo — interface and behaviour

This file owns what the person sees and does: the design principles, navigation
and panes, Home, layout and thumb reach, motion and input, the check-in flow,
the body map, the note field, desktop specifics, accessibility, and (§11–§17)
settings, auth, appearance, themes, the History pane and assets. UI strings live
in `shared/i18n/ui.{en,ru,uk}.ts` under the keys of `shared/i18n/keys.ts`; this
file quotes English copy only where the wording is part of the behaviour. String
rules are in copy.md; dictionaries in data.md §5.

## 1. Principles

These are non-negotiable; they come from the methodology (methodology.md). Code
cites them as "principle N".

### 1.1 Body before words

The step order is fixed (§6.2). Skipping forward is impossible; going back is
always possible.

### 1.2 Never ask "why"

Questions ask _what / where / how much_. The note field rejects abstract-mode
phrases (§8).

### 1.3 Forbidden words

No UI string, notification or theme name contains: en `mood, emotion, feeling`;
ru `настроение, эмоция, чувство`; uk `настрій, емоція, почуття`. A test over all
i18n strings enforces it (`shared/i18n/forbidden.ts`, copy.md).

### 1.4 Null answers are first-class

"nothing", "can't tell", "don't know", "nowhere" and skipping a check-in carry
the same visual weight as every other option: never styled as errors or as
secondary. They are **visible without scrolling at 375×667**, at 390×664 (a
phone under Safari's toolbars) and on desktop: on steps 1, 2 and 6 every null
answer is on screen and tappable as the step opens (§6.7, §7.1; checked by
`e2e/checkin.e2e.ts`). Every answer control shares one set of states, light and
motion (`components/flow/answer.css`), so a null answer cannot look different.

### 1.5 No gamification

No streaks, scores, badges, counters of missed reminders, congratulations.

### 1.6 No emoji, no mood icons, no colour-coding

No emoji, no mood icons, no colour-coding of answers. Highlights are a single
neutral colour.

### 1.7 One neutral highlight colour, in every theme

Body-map selection (`figureSel`) and the intensity control (`bloom`) use a fixed
cool colour that no theme or base colour changes: `#4F46E5` (indigo) on light
grounds, `#8EA2FF` (periwinkle) on dark grounds. Warm red, orange and amber
prime activation, and a highlight that changed with the theme would make answers
given in different themes incomparable. Themes and base colours (Amber included)
still tint everything else. The focus ring uses the same colour (§5.5).

### 1.8 No numbers on sliders

Values are stored 0–10 or −3…+3 and never displayed, not even to screen readers
(§5.6).

### 1.9 Speed

A full check-in is doable in ≤ 60 s. Every target is ≥ 44×44 px. No confirmation
dialogs inside the flow.

### 1.10 The UI never waits for the network

Saving is local; sync status is a quiet dot (§3.4).

### 1.11 The measuring instrument does not change with the theme

Every theme uses the same controls: a slider for intensity, valence, arousal and
head mode; a 2-column grid of options in dictionary order; chips for word level
2; a solid body-map fill without labels; three certainty buttons. Themes change
colour, type, radius, shadow, progress style, heading style and tab style only
(ui.md §14.1).

### 1.12 Reach

On a phone every control rests in the thumb band, the bottom third of the screen
(the bottom half on a phone held sideways), and nothing has to be pulled down to
be reached. What is read sits above, in the stage; new content arrives from the
bottom; a field being typed in sits right above the keyboard. Only the
instrument may reach higher, resting low and growing upward: the step-1 body
figure and the check-in's answer grids. The contract, and which screens still
use the older reach room, are in §4.

## 2. Structure and navigation

### 2.1 Top level

```
Home pane  ◀── swipe / ← → ──▶  History pane  ◀── swipe / ← → ──▶  Settings pane
   └── dot · tab · tap on "Emo" (→ Home) · long-press on "Emo" (→ Settings) · Esc ──┘  (direct)
   │
   ├─ "Now"            → check-in flow (trigger = manual)
   ├─ "after an event" → check-in flow (trigger = after_event)
   └─ notification tap → /now?reminder=<id> → check-in flow (trigger = random)

Settings → Appearance (theme list, base colour, gradient — inline in Settings)
Onboarding (first run): Sign in → Passphrase → Recovery key → Install/notifications/awake window
```

The v1 scope is check-in input, settings, auth and onboarding, and appearance.
Reports, AI chat and other modules are not built and show no placeholders, but
the pane system leaves room for them (§2.2; ui.md §17).

### 2.2 Panes and routes

- Home is a **horizontal row of panes**: `home` (order 0), `history` (order 1)
  and `settings` (order 2) — **Check-in · History · Settings**, input → list →
  settings. Settings is always last: a future Reports pane goes after History,
  before Settings.
- Panes come from a **module registry**, `client/src/lib/panes.ts` (`PANES`), so
  a module plugs in without touching Home:

  ```ts
  interface PaneModule {
    id: PaneId; // 'home' | 'history' | 'settings'
    order: number; // position in the row
    labelKey: MessageKey; // the dot's aria-label and the desktop tab's text
    path: string; // its route
    load?: () => Promise<{ default: Component }>; // lazy (Home is in the shell)
    enabled(): boolean;
  }
  ```

  History and Settings load on first use; History is never prefetched (ui.md
  §15.3).
- **One navigation rule on every pane.** A swipe or ←/→ steps to the neighbour
  pane in that order (Home ↔ History ↔ Settings). Everything else jumps
  **directly** to its target: a dot or desktop tab; a tap or click on the
  wordmark (→ Home); the long press on the wordmark (→ Settings); Esc on History
  or Settings (→ Home); the browser's Back (→ Home; over an open sheet it closes
  the sheet instead, §2.5). There is no back chevron: the dots at the bottom go
  Home, where the thumb is, and a top-left chevron is the hardest reach on the
  screen. So Home ↔ Settings never mounts History, decrypts it or renders its
  rows; only a deliberate swipe or arrow step passes it. Settings' hint reads
  "Swipe right or press ← for History" (below 900 px only).
- **Routes:** `/` Home, `/history` (ui.md §15.3), `/settings` (Appearance is a
  section of it, deep link `/settings#appearance`), `/now` (the check-in).
- Sticky heads inside panes (a pane's title, section and day headers):
  `client/src/lib/sticky.ts`; see ui.md §11 and ui.md §15.4.

### 2.3 The pane bar

- **One pane bar, drawn once** (`components/common/PaneBar.svelte`). App renders
  it above whichever pane is shown (Home, History, Settings) and never re-mounts
  it on a pane switch, so it never moves. There is none in the check-in (`/now`)
  or on auth screens.
- Its row sits on the content column (`max-width: 680px`, centred, sides
  `max(16px, safe-area-inset)`), 12 px + `--safe-top` from the top, 50 px high,
  `align-items: center`. A **left cluster** (`flex: 1; min-width: 0`) holds the
  mark (22 px, ui.md §16.2) and the wordmark **"Emo"** (17 px, 600,
  letter-spacing .02em) 7 px apart as one 44 px button (§2.4), then the sync dot
  (44×44, §3.4), whose signed-out "Not synced" text grows inside the cluster and
  never pushes the tabs. Then the tabs (`flex: none`, desktop only).
- Pane titles stay out of the bar: "History" and "Settings" remain each pane's
  h1. The offline band moves the bar down by exactly 24 px (§3.6).
- Focus order: wordmark → sync dot → tabs → the pane. Activating a tab or dot
  moves focus to the new pane's h1 (on Home: the Now button).
  `aria-current="page"` marks the current one.
- **Phone (< 900 px):** the same row without tabs. The panes are **dots** from
  the same component: a `position: fixed` row centred at the bottom on all three
  panes (`bottom: calc(18px + safe-area-inset-bottom)`, 44 px high) on a
  `ground` pill (radius 22) so rows scrolling under it never collide; 44×44
  targets; the active dot a 22×8 pill in the accent, inactive ones 8×8 circles
  in a `line`-like grey. Panes keep ≥ 62 px + the bottom safe area free under
  their content. Bottom centre is within either thumb's reach, the same for
  either hand, so left-handed mode leaves it where it is. Never top right: it is
  the hardest thumb reach, and labelled tabs do not fit there (uk "Запис ·
  Історія · Налаштування" ≈ 282 px against ≈ 254 px free at 375 px). While an
  on-screen keyboard is up (`html[data-kb]`) the dots are hidden (§4.2).
- **Desktop (≥ 900 px):** the panes as a segmented tab control ("Check-in ·
  History · Settings") flush right against the content column's right edge, top
  12 px. The bar is `position: sticky; top: 0` on the page background (the
  gradient, like `body`'s, is fixed to the viewport), with a 1 px `line`
  hairline only once content has scrolled under it. Each tab is as wide as its
  bold label, so the control never changes width; tabs are 44 px targets (§10).

### 2.4 The wordmark

- A tap or click goes Home. On Home it moves focus to Now and brings the page
  back to where it opens (on a phone the reach room stays out of view, §4.8). It
  never reloads, never changes route, never opens or touches a draft. Enter on
  the focused wordmark goes Home.
- A **long press (600 ms)** opens Settings directly, on every pane. A hold that
  fired never also goes Home; moving more than 10 px or a cancelled pointer
  cancels both.
- Its accessible name is "Emo — Check-in" (`home.wordmark.aria`, like the
  Check-in dot); the hold stays an unannounced shortcut. `cursor: pointer`, no
  hover style.
- Leaving Settings by any route within the reminders' 600 ms debounce still
  saves a valid window, once (ui.md §11).

### 2.5 Sheets and Back

`client/src/lib/sheets.ts` ties sheets to the browser history.

- Every open sheet has its own history entry on the same URL: `ConfirmSheet` and
  the new-recovery-key overlay in Data and keys (a `role="dialog"`). An entry
  copies the state under it (App's `emo` marker stays) and adds `sheet` (a
  token) and `depth`.
- System Back closes the top sheet and leaves the pane where it is. A sheet
  closed by its own buttons, Esc or the backdrop removes its entry, so Back
  never lands on a dead entry; an orphan entry (one released while another sheet
  stood on it, or reached by Forward) is stepped over.
- A busy sheet stays open on Back, with a new entry. The new-recovery-key
  overlay also stays open on Back: the key is shown once, and confirming that it
  is kept is the only way out.
- App writes history for a view change only once no sheet entry is on top: it
  first awaits `unwindAll()`, which closes the open sheets, pops their entries
  in one `history.go(-n)` and waits until that settles, and only then pushes,
  goes back or replaces. Lock and sign-out switch the view first and replace the
  URL afterwards.
- App's `popstate` handler first lets `sheets.handlePopstate` consume the
  sheets' own pops and close the top sheet. `closeTopSheet()` closes the top
  sheet as Back would and resolves once its pop has landed; a busy sheet stays,
  with its entry.
- A reload or a restored tab with a sheet open leaves that sheet's entry behind
  with no sheet. At start App steps back over it, and over any sheet entries
  under it (`dropStale`), before it writes history, so a later Back never
  reopens the pane.
- **Stacked sheets.** A sheet opened over another renders as a DOM sibling after
  it, never inside its snippets. `sheets.ts` gives each open sheet its depth (1
  = the bottom one; 0 once closed; a freed depth goes to the next sheet) and
  tells a sheet when one under it goes, so it moves down a layer.
  `ConfirmSheet`'s backdrop and sheet sit at z-index 38 + 2·depth and 39 +
  2·depth (40/41 for a single sheet). Only the top sheet takes Esc, a backdrop
  tap and Tab, and it stops Esc there, so no pane handler and no sheet under it
  sees it.
- How a sheet sits on the keyboard and in the thumb band: §4.7.

## 3. Home

### 3.1 Layout

Reference: phone 390×844. Background `ground`; the pane bar (§2.3) on top; the
pane dots at the bottom (§2.3). The column is 680 px wide at most with 16 px
sides and `62px + safe-bottom` free at the bottom (18 px + safe-bottom on a
desktop).

- **Phone:** Now sits low in the centre, 24 px above the quiet lines, the free
  space above it; the lines under it are centred; Now and its link are 16 px
  apart.
- **Desktop:** Now is centred in the screen, the link 24 px below it.

### 3.2 The Now button

- A 208 px circle drawn as the mark (ui.md §16.2) in the accent (Calm:
  `#4F46E5`), `components/home/NowBead.svelte`: six discs, each 0.885 of the one
  before and sunk low in it (`BEAD_LAYERS`, `BEAD_RATIO`,
  `client/src/lib/bead.ts`). The five outer ones are at 26 % (`MARK_ALPHA`,
  `shared/brand.ts`) so they take the ground and the ambient light; the core
  (113 px) is opaque and carries the label: white (`--c-on-accent`) 30 px / 500,
  smaller only where it would pass 80 % of the core's width ("Продолжить"),
  never under 16 px. The core keeps the shadow `0 18px 40px -18px accent@60%`.
  Press: `scale(.95)`.
- **It moves only when moved** (`lib/bead.ts`). The whole curl turns toward an
  aim and sinks as deep as the aim is far, so the core points at it:
  - A mouse anywhere on the page is the aim: the core is centred under a cursor
    on Now's centre and leans further out as the cursor goes away, smoothly (63
    % of the way at 1.2 radii), never deeper than 0.9.
  - A press that travels 8 px (`DRAG_PX`) carries the core under the finger, as
    far as the layers reach, and opens nothing.
  - Where the browser gives the tilt without asking (Android), a tilt rolls the
    core toward the low side and a held tilt settles back in about 2.5 s. Where
    the tilt needs a permission (iPhone) it is never asked for; dragging does
    the same.
  - With nothing to follow (touch, the cursor off the page) it rests the mark's
    way at 60 % of the mark's depth (`BEAD_REST`), the label near the middle.
  - Each layer follows on a critically damped spring (10 rad/s following, 20
    rad/s carried), the core last; every disc keeps a rim of the one before.
    Frames run only while a disc is settling.
  - Reduced motion: still, and a press is a press.
- A drag on Now carries the bead; a sideways one also swipes the pane, as
  anywhere on Home (§5.3). A drag never starts a check-in. Two fingers still
  zoom (Now alone has `touch-action: pinch-zoom`, §4.1).
- Dark themes with a cool accent add a rim light that circles three times (24 s
  a lap) and then rests (`--fx-ring`). Now never breathes or pulses.
- Enter or Space on Now starts the check-in. Returning home focuses Now (§5.5).
- **Continue.** While a draft exists that the person closed, the circle reads
  **"Continue"** and reopens the draft on its step (§3.3).

### 3.3 The lines under Now

All are quiet: 13–15 px `muted`, no counts, no colour. Their actions ("Turn on",
"Keep off", "Resume", "Skip it") take the line's muted colour, never the
browser's button text, and are 44 px targets.

- **"after an event"** (`home.afterEvent`): a small secondary link under Now
  that opens the check-in with `trigger = after_event`. 15 px, underlined,
  offset 3 px, colour `--c-accent-text` (ui.md §14.3; the accent itself fails
  4.5:1 as text in some themes and tints).
- **A check-in left open** (a draft the person closed): in place of "after an
  event", one line "A check-in is open." (15 px muted) and the text button
  **"Skip it"** (ink, underlined, 44 px). Skip it ends the draft as stopped on
  its screen, keeping the answers before it (§6.3), with the usual Undo toast
  (§6.14). No step count, no countdown, no colour. "after an event" returns once
  the draft is gone (there is one draft at a time).
- **Reminders aren't reaching this device**: one line above the pane dots,
  "Reminders aren't reaching this device · Turn on · Keep off" (13 px muted, the
  two actions underlined, 44 px), **only when reminders are off without the
  person choosing it**: notifications blocked, permission never granted, the
  subscription lost, or iPhone Safari outside the Home Screen. Never after "Not
  now" in onboarding or the Settings switch turned off (both recorded on the
  device), never during a pause, never where push cannot work at all. "Turn on"
  asks for permission from that tap (blocked or not installed: opens Settings,
  Reminders first); "Keep off" hides the line for good on this device. Too long
  for one row (a 375 px phone), it breaks before its actions, which stay
  together on the row under the words, the dot between them hidden; never one
  action alone. The paused line does the same.
- **Reminders paused**: one line above the pane dots, "Reminders paused until
  Sat 10 Oct, 14:00 · Resume" (13 px muted, Resume underlined, 44 px), from the
  settings cached on this device.
- **Not synced for a day**: one line just above the dots while the sync dot is
  stale (§3.4; architecture.md §8.5).
- **The Undo toast** (§6.14) sits above the pane dots. While it is up it covers
  the lines, so they are hidden under it with their room kept, and come back
  when it goes. It is hidden while an on-screen keyboard is up (§4.2).

### 3.4 The sync dot

It sits in the pane bar (§2.3) and answers one question: are my check-ins on the
server? States and shapes: `client/src/lib/syncDot.ts`; strings `home.sync.*`.

- **Eight states, the first that applies wins** (`DOT_STATES`):
  1. signed out or session expired, plus the "Not synced" text beside the dot
     (never a blocking screen);
  2. `update_required`;
  3. offline — no answer and the device itself reports no network
     (`navigator.onLine`, its `offline` event);
  4. unreachable — no answer from Emo while the device is online, including a
     5xx without `X-Emo-Server` (a reverse proxy answering for a stopped server,
     §3.6);
  5. sending (a sync pass is running);
  6. stale (something has waited over 24 h), plus the line "Not synced for a
     day" (§3.3);
  7. waiting (the outbox is not empty);
  8. synced.

  A request rejected for good has no state of its own (waiting, then stale).
- The dot is a 44×44 button named "Sync: {short state}", with
  `aria-haspopup="dialog"`.
- **Five shapes** (`components/common/SyncGlyph.svelte`): a 12×12 inline SVG in
  `currentColor` — `muted`, "Needs a look" in `ink`, **never the accent**. They
  differ by shape, not colour (WCAG 1.4.1), and stay visible in forced colours:
  solid disc = synced; half disc (1.2 s opacity pulse, static under reduced
  motion) = sending; ring = waiting; slashed ring ("Not connected") = offline
  and unreachable; ring with a centre dot ("Needs a look") = signed out, update
  needed, stale. Each is ≥ 3:1 on `ground`, `surface` and the gradient's second
  colour in every preset.
- **Tap or click** (Enter, Space) syncs — except when signed out or an update is
  needed — and opens the **explanation sheet** (`ConfirmSheet`, a bottom sheet
  on a desktop too, rendered at the pane bar's root, outside its sticky stacking
  context). The sheet shows:
  - the live state's title and detail (it follows the state while open: "Sending
    check-ins…", then "Synced · just now");
  - "Last synced {time}" or "Not synced from this device yet" (not in synced,
    whose title has the time);
  - the legend "What the dot shows": five rows, the shape and one line each;
  - the encryption line "Each check-in is encrypted on this device before it is
    sent; the server stores it but cannot read it.";
  - Close, plus "Sign in to sync" when signed out (closes, then the sign-in
    sheet) or "Go to the update" when an update is needed (closes, then focus on
    the update card's button — or, while that button is disabled, "Getting the
    update…", the card scrolled into view and focus left on the dot).

  There is no "Sync now": the tap already synced. The sheet closes on Close, Esc
  or a backdrop click; focus returns to the dot without reopening the tooltip.
  Signed out is explain-first: two taps to the sign-in.
- **Tooltip** (desktop hover and keyboard focus): `role="tooltip"`,
  `id="sync-tip"`, the button's `aria-describedby`; no focusable content, never
  takes focus. It shows the state's title, its detail, then "Click for details"
  (strings `home.sync.*.title` / `.detail`). `{time}` comes from
  `meta.last_sync_ok_at`: "just now", "5 min ago" under an hour, then "14:32",
  "yesterday 14:32", "7 Oct, 14:32".
- **No count of unsynced check-ins** in the dot, the tooltip or the sheet: it
  would put a counter in the chrome (it appears only in the sign-out discard
  sheet). No digit appears but the `{time}`.
- **Tooltip timing:** after 500 ms of mouse hover, at once on `:focus-visible`;
  hidden 150 ms after the pointer leaves both dot and tooltip, on blur, on a
  pointer down outside, on scroll, when the sheet opens, or on Esc (focus stays
  on the dot). Touch shows no tooltip (the sheet explains) and there is no long
  press (the wordmark has it). A state change while open updates the text in
  place. WCAG 1.4.13: hoverable, dismissable, persistent.
- **Tooltip placement and look:** below the dot, 8 px gap, left edges aligned;
  width `min(280px, 100vw − 32px)` clamped to 16 px gutters; above the update
  card; never over the desktop tabs. `primary` background, `on-primary` text;
  title 13/600, detail 13/400 at 85 %, "Click for details" 13/500 at 85 %;
  padding 8×10, radius 8, no arrow; 120 ms fade, instant under reduced motion.
- **Sheet look:** the detail 16 px ink; the last sync and the encryption line 14
  px `muted`; the legend heading 15/600, rows ≥ 32 px with a 12 px gap.
- **Announced** through a polite live region only on transitions into stale,
  signed out or update needed, and back to synced from those; never unreachable
  (it would chatter on a flaky network).

### 3.5 The update card

One shared `components/common/UpdateCard.svelte`, mounted by App right under the
pane bar's row on Home, History and Settings: 8 px below it, the content
column's width (680 px, 16 px gutters), above the pane's own header — on a phone
too, so it never meets the dots or the Undo toast. Never in the check-in or on
Saved. It is an inline card, not a toast (a toast would time out and collide
with Undo) and not a modal (it would interrupt): it stays until the person acts.
Worker mechanics: reliability.md §3.

- **Ready:** "A new version of Emo is ready" / "Restart to use it. It takes a
  few seconds; your check-ins stay as they are." [Restart now] [Later]. Later
  hides this version's card on this device for 24 h (`localStorage`, keyed by
  the waiting worker's script URL and the time); it returns on the first open
  after that, or at once on a 426.
- **Needed** (`update_required`, sync blocked; no Later): "Update needed to
  sync" / "Your check-ins are saved on this device, but they can't be sent until
  Emo restarts with the new version." [Restart and update]. Until the new worker
  has arrived the button is disabled and reads "Getting the update…"; offline
  the body adds "It will download when you're back online."
- **Open check-in:** while the form is open in another tab (the `emo-draft` lock
  — held exactly while a tab shows the form, not merely while a draft exists),
  "ready" is hidden and "needed" stays with its button disabled and "Finish or
  close the open check-in first." A draft the person closed shows the card.
- **Restart:** both buttons disabled, the primary shows a spinner and
  "Restarting…"; pending local writes (a sync pass) are awaited, then
  `{type:'SKIP_WAITING'}` is posted; the page reloads on `controllerchange`, or
  after 8 s regardless. If the same version still waits after that reload, the
  body adds "Couldn't restart. Try again."
- **Look:** theme tokens only — `surface`, 1 px `line` border, radius 16,
  padding 14×16; title 15/600 ink; body 14/1.4 muted; primary 44 px in
  `primary`; Later a 44 px ink text button. "Needed" adds only a 3 px `accent`
  rule at the left. No red or amber, no icon, no pulsing, no badge on the tabs.
  200 ms fade and height on arrival, instant under reduced motion.
- **Screen readers:** a `<section>` labelled by its title (a region); title and
  body announced once per state through a polite live region, never
  `role=alert`. Focus never moves (tab order: pane bar → card → pane); after
  Later, focus moves to the pane's first control.
- Settings → About keeps "App {v} · update ready — Restart" (a link) while a
  version waits, also after Later (ui.md §11).

### 3.6 The offline band

- While the server cannot be reached, a 24 px band sits at the very top of
  **every** screen (sign-in, onboarding, unlock, Home, the form, Settings): a
  crossed-out cloud and its words (12 px / 500, `muted`) centred on `ground`, a
  1 px `line` hairline below, above the safe area
  (`components/common/OfflineBand.svelte`). The words follow the cause:
  "Offline" (`common.offline`) when the device reports itself offline
  (`navigator.onLine`), otherwise "Can't reach the server"
  (`common.unreachable`: a server down behind its proxy, a network without
  internet).
- It never covers a control: while it shows, `--safe-top` grows by 24 px, so
  every screen that keeps clear of the notch keeps clear of the band too. It is
  not interactive and never blocks (§1.10): saving stays local.
- Offline means **no answer from Emo**. The browser's `offline` event shows it
  at once; any API request that gets no answer shows it, and so does a 5xx
  without `X-Emo-Server` (Emo sets the header on every response, its errors
  included — api.md §1, reliability.md §1.5); any other answer, an error too,
  hides it.
- While it shows, `GET /api/instance` checks again on `online`, when the app
  becomes visible, and every 10 s → 60 s while visible
  (`client/src/lib/network.ts`). On `online` the device counts as online only
  once that check has answered (or after 3 s), so the band goes from "Offline"
  straight to gone rather than through "Can't reach the server".
- Screen readers: a polite live region that stays mounted announces, by the same
  cause, `errors.offline` ("You're offline. Entries are saved here and will sync
  later.") or `errors.unreachable` ("Can't reach the Emo server. Entries are
  saved here and will sync later."). The same text is the band's tooltip on
  desktop.

## 4. Layout and reach

### 4.1 Baseline

- **Phone baseline:** 390×844. Side padding 20–24 px. The content column fills
  the width. Phone means < 900 px wide (`PHONE` in `client/src/lib/reach.ts`).
- **Safe areas** (`env(safe-area-inset-*)`, as `--safe-top` / `--safe-bottom`)
  for header and footer. The bottom inset is applied once: by the check-in
  footer, Saved's button row and the other-window footer. The flow column adds
  only 1 rem under it.
- **Desktop (≥ 900 px):** content column `max-width: 680px`, centred, 48 px top
  padding. Option grids become `repeat(auto-fit, minmax(190px, 1fr))`. Details:
  §9.
- **Landscape phone:** as a phone; the body figure scales by height (an SVG with
  `preserveAspectRatio="xMidYMid meet"`).
- **Overscroll and touch.** `html, body { overscroll-behavior: none }`: no
  rubber band, no pull-to-refresh, no chaining past the page (`body` is the
  scroller). Every inner scroller — the check-in's `main`, a sheet's body
  (`ConfirmSheet`), full-screen overlays, a text area — has
  `overscroll-behavior: contain`. `body { scrollbar-gutter: stable }`, so the
  column and the pane bar never shift between a pane that scrolls and one that
  does not. Buttons have `touch-action: manipulation` (no double-tap zoom) and
  no long-press callout or text selection; text elsewhere stays selectable.
  Home's Now alone has `pinch-zoom`: a finger's drag there carries its bead
  (§3.2), and a sideways one the pane too (§5.3), so the page may not pan from
  it. Pinch-zoom is never disabled.

### 4.2 Layout tokens

On `<html>`; defaults in `client/src/boot.css`, written by
`client/src/lib/viewport.ts` and `client/src/lib/layout.svelte.ts`.

- `--vvh`: the visual viewport's height, which the on-screen keyboard shrinks;
  `100dvh` until first written; held while the page is pinch-zoomed.
- `--vv-top`: the visual viewport's top within the layout viewport (iOS moves it
  up to show a low field).
- `--kb`: the inset of the visual viewport's bottom from the layout viewport's
  bottom: the keyboard's height less how far iOS has panned the view up, and
  where a fixed sheet's bottom goes. 0 with no keyboard.
- `--band`: the thumb band's height, `calc(var(--vvh) / 3)`; under
  `html[data-short]`, `min(var(--vvh), max(300px, calc(var(--vvh) / 2)))`.
- `--dock-h`: the bottom dock's height, which a band's bottom padding keeps
  clear. 0: no screen has a bottom dock.
- `html[data-kb]`: an on-screen keyboard is up: a text field has focus and the
  visible height is more than 120 px (`KB_MIN`) short of the layout viewport's,
  however far iOS has panned it. With no field focused there is no keyboard,
  whatever the viewport says, and `--kb` is 0.
- `html[data-short]`: a phone whose keyboard-free height is under 500 px (held
  sideways). That height is held while a keyboard is up, so typing never flips
  it; only turning the phone does.

While `html[data-kb]` is set, the fixed pane dots (`nav.dots`) and the toast
(`.toast-container`) are hidden, so they never ride on the keyboard; the
check-in's progress dots are not touched.

### 4.3 The viewport and layout modules

- **`client/src/lib/viewport.ts`** reads the on-screen keyboard from
  `visualViewport`, one path for iOS and Android. There is no
  `interactive-widget`: resizing the content would flip height queries
  mid-typing and squeeze the check-in. `startViewportWatch()` runs in `main.ts`
  before the app mounts. It follows the visual viewport's `resize` and `scroll`
  and the window's `resize`, at most once a frame, and writes `--vvh`,
  `--vv-top`, `--kb` and `data-kb`, each only when it changes. It reads again
  when focus enters or leaves anything, on every screen change
  (`refreshViewport()`, `App.svelte`) and when Saved replaces the note (a
  removed field does not fire blur everywhere). While the page is pinch-zoomed
  (scale > 1.01) every value holds, except that `data-kb` and `--kb` drop once
  no text field has focus.
  - `keyboardFreeHeight()` is the layout viewport's height as last seen with no
    keyboard up; it is also held when a browser's keyboard resizes the page
    while a field has focus. `ui.layout` and `layout.short` read it.
  - `aboveKeyboard(el)` replaces `scrollIntoView` for fields. With a keyboard
    up, it scrolls the nearest scroller so the field's bottom sits 12 px above
    the keyboard's top, or above the scroller's visible bottom when that is
    higher (a sheet's buttons). A field already in view with 8 px or more to
    spare stays where it is. With no keyboard it acts as
    `scrollIntoView({block: "nearest"})`. It skips fixed boxes that do not
    scroll and never scrolls the page while zoomed. It is smooth only when asked
    and when motion is not reduced.
- **`client/src/lib/layout.svelte.ts`** (`startLayout()` after the viewport
  watch): reactive `layout.phone` (< 900 px wide), `layout.short` (a phone whose
  keyboard-free height is under 500 px; also `html[data-short]`) and `layout.kb`
  (a keyboard is up). `short` holds while a keyboard is up, so typing never
  rearranges a screen. The check-in's width query and its layout record use it
  (§6.4).

### 4.4 The check-in skeleton (phone)

- One screen high (`100dvh`): `header` (the progress only, plus the step label
  of themes that show one and the "after an event" badge, §6.2) · `main`
  (`flex: 1`, `min-height: 0`, scrolls internally when needed) · `footer`.
- The footer, top to bottom: the step's pinned null pair (steps 1–2), the exits
  row (the selection summary at the left on steps 1–2; "Stop here" or "Skip
  check-in" and × at the right, §6.3), then Back 56×56 and Next (flex, 56 px
  high). Padding 12 px 20–24 px 20–26 px.
- The page itself never scrolls, so nothing in the footer moves. Long option
  lists (step 2's 21 sensation words) scroll inside `main`; what sits in the
  footer — the null pairs of steps 1–2 and their summary — stays visible.

### 4.5 The reach contract

On a phone (< 900 px) every control rests in the thumb band. A desktop (≥ 900
px) is not affected. Some screens still use the reach room of §4.8 in its place;
§4.9 lists which.

- **The thumb band.** The bottom ⅓ of the keyboard-free visual viewport. On a
  phone under 500 px tall (held sideways, `html[data-short]`) it is the bottom
  half, at least 300 px, and never more than the screen. In code:
  `client/src/lib/band.ts` `bandHeight(h)` and `bandTop(h) = h − bandHeight(h)`;
  in CSS, `--band` (§4.2). The contract holds at rest, with no keyboard up;
  `--band` and `restLow` follow the visible height (`--vvh`), so they shrink
  while a keyboard is up.
- **Screen = stage + band.** The stage holds what is read: the question, status,
  previews and summaries. The band holds every control, anchored to the bottom.
- **New content arrives from the bottom,** inserted above the control that
  caused it, so nothing moves under the finger.
- **Keyboard-aware sheets.** The focused field sits right above the on-screen
  keyboard. Return moves to the next field, or submits from the last (§4.7,
  §5.4).
- **No pull gesture.** No control is reached by pulling a screen down.
- **Two instrument exceptions.** The methodology needs the whole instrument in
  view (§1.4, §1.11), so these two may reach above the band, always resting low
  and growing upward from the check-in's footer:
  - **(a) The step-1 body figure** stays whole on screen at rest, tappable and
    anchored low. On short phones its zones scale with the figure, to no less
    than 36 px tall (the narrowest zones, 36 of 260 units wide, to no less than
    29.5 px). The `bodyFigure` geometry does not change (§7).
  - **(b) The check-in answer grids** rest with their bottom on the footer and
    grow upward. Every option on steps 6, 7 and 9 is visible at rest. Step 2
    shows at least 18 of 21 options at 390×844 and 12 at 375×667 (the full table
    is in §4.10). Null answers stay in their grids in dictionary order (§1.11).
    Only step 2's pinned pair and step 1's Whole body / Nowhere are pinned in
    the footer. Only the question may scroll off.

  Everything else in the check-in is strictly in the band: nav, Stop here, help,
  the pins, certainty, sheets and editors.

### 4.6 Rest low

`restLow(scroller, {anchor, stage})` (`client/src/lib/band.ts`) makes a screen's
band start at the thumb band's top edge. It writes `--stage-min` =
`stageMin(h, top)` = `max(0, ceil(bandTop(h) − top))`, where `h` is the visible
height and `top` is the stage's top with the scroller at its top; on a desktop
the value is 0. The classes it serves are in `client/src/fx.css`; they apply on
phones only and are prefixed, so they never meet BodyMap's `.stage`:

- `.rl-root`: a flex column at least as tall as its scroller.
- `.rl-stage`: at least `--stage-min` tall, its content at its bottom. More
  stage content pushes the band down into the scroll.
- `.rl-band`: its bottom padding keeps clear of the home bar and `--dock-h`.

It measures again one frame after a resize of the visual viewport or the window,
a phone/desktop change, or a size change of the scroller, the stage or the
content. `rest()` goes to the top (`anchor: 'start'`) or to the end (`'end'`). A
scroller anchored at the end stays pinned there while it is at its end and
content grows; once scrolled up, it keeps its place.

No screen is laid out with `restLow`; it is the building block for moving a
screen onto the contract (§4.9).

### 4.7 Sheets in the band and on the keyboard

`ConfirmSheet` (`components/common/ConfirmSheet.svelte`) is the one sheet
primitive.

- **Parts.** `children` is its body. `stage` (read-only: status, previews) comes
  first, in the same scroller. `band` holds the controls and rests at the
  sheet's bottom, right above the actions row, with no reach room; the body's
  content rests on the band when there is room to spare. `aside` is one quiet
  action at the left of the actions row. `size: 'tall'` takes the sheet's whole
  max height; the default `'content'` is as tall as the content. The confirm
  sits at the bottom right.
- **On the keyboard.** On a phone the sheet stands on the on-screen keyboard:
  `bottom: var(--kb)` and
  `max-height: min(90dvh, var(--vvh) − var(--safe-top) − 8px)`. With no keyboard
  that is 90dvh; the plain `--vvh` form would make tall sheets about 10 %
  taller. While `html[data-kb]`, `--safe-bottom` is 0 inside it, because the
  keyboard covers the home indicator.
- **Typing** (a keyboard up and a field of the body focused, in a sheet without
  a band). The sheet takes its full max height and gets room above its content,
  a top margin of `--reach` + `--vvh`. `aboveKeyboard()` then brings the field
  down right over the actions row, 12 px above the body's bottom, about 96 px
  above the keyboard. Return moves to the next field, which comes down there
  too. When the keyboard goes, the body returns to its resting place with the
  field still in view. The sheet and its content wrapper have
  `transition-property: none`, so all of this lands at once, under reduced
  motion too.
- **Desktop.** A desktop sheet keeps 90dvh at the bottom whatever the keyboard
  does.
- **Reach room.** A sheet without a `band` keeps the reach room (`keepReach`,
  §4.8) inside its body; a sheet with a `band` has none.
- **Stacking and Back:** §2.5. **Motion:** §5.1.

### 4.8 The reach room

Screens that do not meet the contract (§4.9) follow these rules instead. They
apply on phones only.

- **The main action at the bottom.** Each screen's primary action sits at the
  bottom, full width or at the right: Next and Save, Done, the sheets' confirm
  (bottom right), Now (§3.2), the sign-in cards' buttons (ui.md §12).
- **Text actions at the right edge.** A link or text button that stands on its
  own line ends at the right edge (History's "Delete this check-in", Settings'
  "How to allow", "Sign out on this device", "Delete account", About's links,
  the sign-in links, the check-in's help links); in a row, it is the row's last
  item. Button pairs put the primary in the corner (the note's "Remove …", Allow
  notifications, the update card's Restart). A link inside a sentence stays in
  the sentence.
- **Content low.** What does not fill the screen sits at its bottom, the free
  space above: a slider or the urges with their question (§6.9), Home's Now, the
  sign-in cards. Content that can grow in place (step 6's certainty, step 9's
  "other") stays top-aligned, so a reveal never moves what was just tapped.
- **The reach room.** Every scroller — the page (panes, sign-in screens), the
  check-in's `main`, a sheet's body without a `band` — keeps room above its
  content: enough to bring its top edge down to two thirds of the screen's
  height (`roomFor(height, top) = max(0, ceil(2·height/3 − top))`), so a pull
  down brings its topmost control into the bottom third (the wordmark and the
  sync dot, step 2's first sensations, a sheet's first field). A screen and a
  step open with the room just out of view (`restingTop`), so they look as
  without it; going to another screen or step returns there. A sheet keeps its
  own height (the room scrolls inside its body). At that resting place nothing
  is held when content above changes (scroll anchoring is off there, as at the
  very top), so a card or a longer hint pushes the content down in view. The
  room is plain ground, empty and silent for screen readers.
- **Implementation:** `client/src/lib/reach.ts`.
  `keepReach(scroller, {spacer,
  fit, wanted})` sizes the room (a spacer's
  height, or `--reach` on the scroller) and rests it; `startPageReach()` is the
  page's own room (App), off while the form shows (the form has its own, in
  `CheckInFlow`). The room's CSS says `transition-property: none`: under reduced
  motion every property takes a 0.01 ms transition (`boot.css`), which would
  land a frame after the scroll position is set.
- **What stays at the top.** Status, not action: the progress, the pane bar's
  wordmark and sync dot (reachable by the pull), the update card (rare; its
  Restart at the right).

### 4.9 Which screens meet the contract

`e2e/reach_pending.ts` (`PENDING`) lists every audited state that does not meet
the contract, keyed `state@WxH@locale` (`*` = any size or language), in one
group per area:

- **Meets the contract:** the sync sheet; the check-in's help sheets; step 1 at
  390×844; steps 2–5 and 8 in landscape; Saved; the `/now` other-window screen;
  every confirmation sheet; onboarding's reminders step; unlock at rest at
  390×844 and in landscape; the sheet keyboard on portrait phones.
- **Still on the reach room** (listed in `PENDING`): **Home and the chrome:**
  every Home state. **System screens:** storage damaged and account gone on
  portrait phones. **Check-in:** step 1 everywhere but 390×844; steps 2–9 on
  portrait phones, step 9's keyboard included; steps 6, 7 and 9 in landscape.
  **History:** all five rest states. **Settings:** at rest, Reminders offline,
  the export and change-passphrase sheets, the sheet keyboard in landscape.
  **Auth, onboarding and unlock:** every screen with a field; the About sheet on
  portrait phones; account switch and recovery pending in landscape; unlock on
  the short portrait sizes.

**Moving a screen onto the contract:** lay it out with `restLow` and the `.rl-*`
classes (or a sheet `band`), drop its `keepReach` / page reach room, delete its
group from `PENDING`, and run the audit. When `PENDING` is empty,
`client/src/lib/reach.ts`, `reach_test.ts` and the last `keepReach` go, and the
audit runs under `REACH_STRICT=1`. A bottom dock, when one exists, marks its
controls `data-reach-pin` and sets `--dock-h`.

### 4.10 The reach audit

`e2e/audit.e2e.ts`, part of `make e2e`, holds every phone state of
`e2e/states.ts` (each "rest" or "scrolled") to the contract. The default matrix
is English at 390×844, 375×667, 390×664, 844×390 and 390×844 with a 34 px bottom
inset, plus Russian and Ukrainian at 375×667 and 844×390. `REACH_FULL=1` runs
every language at every size. `tools/capture_reach.ts` (`make capture`) records
the same states as screenshots and every control's box. The other switches
(`REACH_WRITE`, `REACH_JOBS`, `REACH_ONLY`, `REACH_VERBOSE`) are described in
the header of `e2e/audit.e2e.ts`.

- **(a)** At rest every interactive control, disabled ones included, has its top
  at or below `bandTop(vvh)` and its bottom on screen. A list that scrolls
  inside itself may hold rows out of view.
- **(b)** Every primary, nav, pin and dock control (`KEY`: `.btn-primary`, sheet
  actions, the pane dots, the check-in footer, Saved's actions, `[data-null]`,
  the toast, `[data-reach-pin]`) is whole on screen, not clipped by a scroller,
  and a tap at its centre reaches it.
- **(c)** Step 1's figure is whole on screen, and every zone is at least 36 px
  tall and 29.5 px wide and reachable at its centre. Steps 6, 7 and 9 show every
  option at rest, and steps 2, 6, 7 and 9 every null answer. Step 2 shows at
  least: 18 at 390×844, 16 with the 34 px inset, 12 at 375×667, 12 (en) or 10
  (ru, uk) at 390×664, and 2 at 844×390 (`STEP2_MIN`).
- **Scrolled** states hold only the pinned controls to (a) and (b).
- **Keyboard.** In each rest state a keyboard is shown: 336 px at 390×844, 260
  px at 375×667 and 390×664, 200 px at 844×390. Each text field on screen (up to
  four) is focused in turn. The field and its submit must sit whole between the
  screen's top and the keyboard, be reachable, and each end within 120 px of the
  keyboard's top. The result is reported as `<state>+kb`.
- A failure listed in `PENDING` is reported (console summary and
  `e2e/report/reach_audit.json`); any other failure fails `make e2e`.
  `REACH_STRICT=1` also fails on a listed state that passes and on an entry
  nothing matched.

## 5. Interaction

### 5.1 Motion

Calm, cool light, and nothing ever waits for an animation. A touch is answered
at once (press, colour); new content **arrives** with a short compositor-only
settle and never departs slowly; light is daylight on light themes and soft
emission on dark ones, and inside the check-in all light is cool.

- **Pane change (Home ↔ History ↔ Settings):** View Transition (Chrome 111+,
  Safari 18+): only the pane moves, 32 px sideways and crossfading; the pane
  bar, the dots and the background stay put; any pointer or key ends it at once.
  Without one: the new pane settles in from 24 px — old 180 ms `--ease-in`, new
  280 ms `--ease-out` after 40 ms; fallback 280 ms.
- **Pane dots:** the current pane's pill grows 8 → 22 px as the old one shrinks
  — 280 ms `--ease-spring-soft`.
- **Enter check-in (Now, a reminder, Continue):** step 1 complete and
  interactive in the first frame; its `main` rises
  `translateY(6px) scale(.985)
  → none`, transform only; the done progress
  fills from empty — 220 ms `--ease-out`; fill 240 ms.
- **Next / Back step:** the new step at once; the heading block (carry line,
  eyebrow, title, hint) `translateX(±16px) → 0`, the answers and the step's
  footer pieces (null pair, summary) `±8px → 0`, transform only; header,
  progress and the Back/Next row still — 180 ms `--ease-out`.
- **A part revealed in a step (certainty, "other", note callout, "Check-in
  undone"):** rises 6 px, no fade — 180 ms `--ease-out`.
- **Front ↔ Back body view:** figure `scaleX(.86) → 1`, opacity .55 → 1, zones
  tappable throughout; the segmented puck slides — 220 ms `--ease-out`; puck 280
  ms `--ease-spring-soft`.
- **Option select / deselect:** fill, border and text colour (the same both
  ways); the selected halo; press `scale .98` on every answer alike — colours
  140 ms `--ease-standard`, halo 180 ms; press 90 ms in, 360 ms spring out.
- **Body zone:** fill-opacity, the same on and off; hover and press tint in the
  fixed highlight; nothing on the figure moves — 140 ms.
- **Slider:** grab: thumb `scale(1.1)` and a stronger halo, a spring on release;
  the first input sends out one ring ("set"); untouched never moves (a value the
  browser sets at a press that turns into a scroll goes back at once) — 90 ms
  in, 360 ms spring; ring 420 ms.
- **Progress:** segments, bar and rule fill as `scaleX`; the current dot's pill
  width springs — 240 ms in, 160 ms out; bar 280 ms; dots 280 ms.
- **Next enabled:** colour and light only: no sweep, no pulse — 140 ms, halo 180
  ms.
- **Saved screen:** the status fades in rising 10 px, the buttons 60 ms later;
  no drawn check, no pop; the same for every outcome (§6.14) — 400 ms
  `--ease-emphasized`.
- **Back on Home (Saved, Close):** Now `opacity .4 → 1, scale .96 → 1`, focused
  and tappable at once; the lines under it fade in; the toast rises 200 ms later
  — 400 ms `--ease-emphasized`; lines 280 ms after 80 ms.
- **Sheets:** the scrim fades in; the sheet rises from below; leaving, it sinks
  and is inert at once — 280 ms `--ease-emphasized` in, 200 ms `--ease-in` out.
- **Toast:** rises 16 px; on timeout sinks 8 px and fades; Undo leaves at once;
  the countdown drains as one `scaleX`; Undo is armed after its delay + 350 ms
  (§5.2) — 280 ms in, 160 ms out.
- **Sign-in screens (email → code → passphrase → key → reminders; unlock ↔
  recover):** View Transition: the card keeps its place, its size morphs, its
  content crossfades. Without one: the content settles in from 16 px, never
  fainter than .35 — 280 ms `--ease-in-out`.
- **History record:** the row folds open (grid rows), the content fades in after
  it; closing folds and fades — 280 ms open, 200 ms close.
- **Switch:** the knob springs across and stretches a little toward its travel
  while pressed — 360 ms `--ease-spring`.
- **Busy primary button (sign-in, deriving the key, a save over 250 ms):** an
  arc of light circles its rim (`@property`); without it, and under reduced
  motion, the spinner and a still rim — 1.4 s a lap.
- **Now:** never moves on its own, never breathes or pulses; a mouse, a drag or
  a tilt leans the core, the layers follow, the core last, and settle back
  (§3.2). Dark themes with a cool accent: a rim light circles three times, then
  rests — 24 s a lap; springs 10 rad/s (20 carried), critically damped.
- **Moving background:** ui.md §13 — 37, 53, 71 s.

**Tokens** (`client/src/boot.css`; `client/src/lib/motion.ts` mirrors them as
`DUR` and `EASE`, and `motion_test.ts` keeps the two equal): `--dur-1` 90 ms (a
finger goes down), `--dur-2` 140 ms (state colour), `--dur-3` 180 ms (content
arrives), `--dur-4` 280 ms (surfaces), `--dur-5` 400 ms (calm screens),
`--dur-spring` 360 ms, `--dur-spring-soft` 420 ms; curves `--ease-standard`,
`--ease-out`, `--ease-in`, `--ease-in-out`, `--ease-emphasized`, and two damped
springs as `linear()` (6.8 % and 1.1 % overshoot; back-out cubic-béziers where
`linear()` is missing). Springs only for what the finger moves or releases;
colours and opacity never spring.

**Step changes.** Nothing waits for the arrival. The new step is in the DOM,
focused (§5.5) and interactive in the frame of the tap; the arrival only moves
it the last 16 / 8 px on the compositor (< 0.2 ms of script) and never fades
text (a ramp from .72 would put hints under 3:1). A tap aimed at the new step
needs ≥ 200 ms, by which the move is over, so `latency_sec` is unchanged by
construction; `e2e/fx.e2e.ts` taps an option 20 ms after Next and it registers.
Never a slide per transition: 320 ms on each of the 8 transitions would cost ≈
2.9 s a check-in. **No View Transitions anywhere in the check-in:** while one
runs the page is a picture and taps miss.

**Rules.** Nothing on an answer control lasts longer than 220 ms; nothing in the
check-in loops; options never appear one after another; no sweep or pulse on
Next; nothing anywhere breathes (no period between 3 and 20 cycles a minute).
Script-driven motion (WAAPI, View Transitions, Svelte transitions) goes through
`lib/motion.ts`, which honours reduced motion; CSS motion uses the tokens.

**Reduced motion** (`@media (prefers-reduced-motion: reduce)`): all animations
and transitions off (instant state changes), the View Transition pseudo-elements
and every script-driven animation too; every effect has a still end state (the
moving background a still picture, the toast's countdown full). Themes cannot
override this.

### 5.2 Settle times

- **Step settle.** For **350 ms** (`STEP_SETTLE_MS`, `lib/machine.ts`) after
  every step change (Next, Back, a swipe, a key), Next, →/PageDown and a swipe
  commit are ignored, also under reduced motion: a quick second tap meant for
  the screen that just left never answers or skips the question that just
  arrived. Opening the form is not a step change (a double tap on Now lands on
  the figure, not on Next).
- **Help sheet close.** For 350 ms after a help sheet closes, a transparent
  shield takes every tap (§6.6).
- **Destructive settle.** A destructive confirmation (a red confirm) keeps its
  confirm disabled for its first 350 ms, so a quick second tap on the row that
  opened it never confirms. The button is really `disabled`, not a swallowed
  tap.
- **Toast arming.** The Home toast's Undo takes no tap until the toast has risen
  in: its delay + max(280 ms, 350 ms), also under reduced motion. Until then the
  toast itself takes the tap, so a second tap on "Skip it" never lands on "after
  an event" under it.

### 5.3 Swipe

`client/src/lib/swipe.ts`; one `paneSwipe` action (`use:paneSwipe`) does all of
this on Home, History and Settings; the check-in uses the same rules for steps.

- Pointer events on the pane root; `touch-action: pan-y pinch-zoom`, so vertical
  scrolling and pinch-zoom still work.
- A swipe never starts (`swipeStartOK`): on `input`, `textarea` or `select`
  (sliders, the note, the "other" field); inside a dialog or a `[data-no-swipe]`
  element; while any dialog is open; within 24 px of the left or right edge (the
  system back gesture, `SWIPE_EDGE_PX`); with a second finger; from a mouse (a
  touch or pen drag only); while the page is pinch-zoomed
  (`visualViewport.scale > 1.01`: dragging a zoomed page pans it and never
  changes pane).
- **Axis lock:** after 10 px of movement decide horizontal vs vertical
  (`|dx| > |dy|`); vertical → no drag feedback (the page scrolls; the browser
  cancels the pointer). The lock is only the feedback's: the commit always reads
  the whole drag.
- **Drag feedback:** while dragging sideways (the pointer captured), the content
  follows by `translateX(dx × k)`, clamped to ±140 px, transform only. `k = 0.6`
  toward an existing step or pane, `k = 0.2` (rubber band) toward none: forward
  on an invalid step, back on step 1, right on Home, left on Settings. On a pane
  it is the pane root's children that move, except what is fixed to the screen
  (the Home toast), so the pane View Transition leaves from where the finger let
  go. No transition while dragging. On release the content springs back over 280
  ms on the soft spring (`--ease-spring-soft`), and a committed swipe then
  changes pane. A `pointercancel`, a second finger or the page going hidden ends
  the drag with no step. Under reduced motion nothing follows the finger, and
  the commit is unchanged.
- **Commit:** `|dx| ≥ 60 px` and `|dy| ≤ 0.7 × |dx|`. In the check-in: left →
  `next()` (a no-op if the step is invalid), right → `back()`. On panes: left →
  next pane, right → previous pane.
- Swiping on the body figure **does not** flip Front/Back (the tabs do that); a
  swipe always navigates steps.

### 5.4 Keyboard

| Context                        | Key                          | Action                                           |
| :----------------------------- | :--------------------------- | :----------------------------------------------- |
| Home, History, Settings        | ← / →                        | previous / next pane                             |
| History, Settings              | Esc                          | Home (an open sheet takes Esc first)             |
| Home                           | Enter / Space on Now         | start a check-in                                 |
| Check-in, focus not in a field | → or PageDown                | next (if valid)                                  |
| Check-in, focus not in a field | ← or PageUp                  | back                                             |
| Option groups                  | Tab / Shift+Tab              | move between options (each is a real `<button>`) |
| Option                         | Space / Enter                | toggle                                           |
| Front/Back tabs (`role="tab"`) | ← / →                        | switch view; never change step                   |
| Slider                         | ← → Home End PageUp PageDown | native range behaviour                           |
| Untouched slider               | Space / Enter                | answer the midpoint (§6.9)                       |
| Note textarea                  | Ctrl/⌘ + Enter               | save (= next on the last step)                   |
| Sheet, one-line field          | Enter                        | next field; in the last field, confirm           |
| Destructive sheet, field       | Enter                        | move focus to the confirm only                   |
| First new-passphrase field     | Enter                        | focus Repeat (ui.md §12)                         |
| Repeat field                   | Enter                        | submit once both match                           |

On a phone with the keyboard up, Enter's next field comes down right over the
sheet's buttons (§4.7).

Window `keydown` listeners exist only in App (Esc on History and Settings →
Home), Home, History, Settings and the check-in root, each acting only while its
view shows. While a help sheet is open, →/←/PageUp/PageDown do nothing.

### 5.5 Focus

- On every step change, focus the step's `<h1>` (`tabindex="-1"`,
  `preventScroll`) so screen readers announce the question — the last screen
  too: the note is **never** focused by itself, on any device (an open keyboard
  reads as "write something"; the cost is one tap for those who write) —
  **except** step 9 when "other" is already selected: focus the "other" input.
- **Any text input that appears gets focus,** on the next frame (~40 ms after
  render): choosing "other" focuses its field. Once only: a change elsewhere on
  the screen (typing in the note) never takes the focus back to it. In auth: the
  invite field when "I have an invite code" opens it, the code field when it
  appears, the first passphrase field (or the recovery-key field) on arrival
  (ui.md §12).
- Returning home focuses the **Now** button.
- Implementation: compare previous and current step in your own stored snapshot;
  never rely on framework-specific previous-state arguments (this crashed in the
  prototype).
- **Visible focus ring everywhere:** `outline: 3px solid var(--c-focus)`,
  `outline-offset: 2px` (`:focus-visible` only), at once. `--c-focus` is the
  fixed highlight (`#4F46E5` / `#8EA2FF`, §1.7), not the accent: never warm,
  never black on black in Mono, ≥ 4.9:1 on every ground. Around it a soft halo
  in the same colour (`--fx-focus-halo`) comes up in 180 ms. One ring: a focused
  field shows the ring, not a coloured border as well.

### 5.6 Screen reader

- The progress bar is `aria-hidden`; a visually hidden `aria-live="polite"` text
  says "Step N of 9" (`a11y.step.announce`).
- Selection summaries are `aria-live="polite"`.
- Multi and single choices: `<button aria-pressed>` inside `role="group"`
  labelled by the question.
- Sliders: `aria-labelledby` the question; `aria-valuetext` uses words, not
  numbers: "closer to “barely there”" / "in the middle" / "closer to “very
  strong”" (thresholds t < 0.35, t > 0.65; valence's centre reads "neutral"),
  prefixed "not moved, " while untouched (`a11y.slider.*`).
- Body zones: real buttons with `aria-label` = the zone label and
  `aria-pressed`. The mirrored duplicate targets (second arm, second leg, extra
  hit boxes) are `aria-hidden` and `tabindex="-1"`, so each zone is announced
  once (§7.3).

## 6. Check-in flow

### 6.1 Entering the flow

Home has one main button, Now (§3.2). The `trigger` of a check-in:

- **Notification tap** → the app opens on `/now?reminder=<id>` →
  `trigger = random` with `reminder_id`. A tap later than 15 minutes after the
  notification appeared (`REMINDER_RESPONSE_WINDOW_MIN`, `shared/protocol.ts`)
  opens `/now` with `trigger = manual` (architecture.md §9.2).
- **Opened by the person** (Now, the `/now` shortcut) → `trigger = manual`; but
  if a notification younger than 15 minutes still shows on this device, the
  check-in answers it: `random` with its `reminder_id`
  (`client/src/lib/reminderLink.ts`; reliability.md §2.3). The person answered
  the signal, just not through the notification.
- **"after an event"** under Now → `trigger = after_event` (§3.3).
- A draft the person closed reopens through **Continue** (§3.2); it never
  reopens by itself (§6.3).

### 6.2 Screens and the state machine

`client/src/lib/machine.ts` is a pure TS module (no Svelte, no I/O, `now` passed
in, unit-tested); `client/src/lib/checkin.ts` wraps it with opening, Close, the
abandon rule, saving, stopping and Undo; `components/flow/CheckInFlow.svelte`
renders it. Nine screens, strictly in the order of data.md §4, one block each
(`machine.STEPS`); the note sits under the situation on the last screen:

```
locations → qualities → intensity → valence → arousal → word → urge → head_mode → context + note → [save]
   1            2           3          4         5        6      7        8            9
```

- `next()` only if the step is valid (`isStepValid`); step 9's Next is Save.
- `back()` always keeps the answers; it is disabled on step 1 (Back at 35 %
  opacity).
- The header shows "after an event" (13 px, muted) under the progress when
  `trigger = after_event`; the header holds nothing else but the step label of
  themes that show one (ui.md §14.4).

**Validity** (`isStepValid`):

- **1 locations:** ≥ 1 zone, or Whole body, or Nowhere.
- **2 qualities:** ≥ 1 option.
- **3–5, 8 sliders:** touched: a slide along the track, a still tap (on the
  thumb, within 22 px: the midpoint; elsewhere on the track: the value under the
  finger), Space / Enter (the midpoint), or a key or assistive-technology
  change; never a scroll, pull or pinch that starts on it.
- **6 word:** no word, or word + certainty chosen ("don't know" sets the
  certainty itself).
- **7 urge:** always (optional).
- **9 context:** one option chosen (the other-text optional), and the note empty
  or passing the validator (§8).

**Next label:** step 1 → §7.6; steps 2–8 → **"Next"** (+ an arrow icon in themed
variants); step 9 → **"Save"**. Disabled Next: `track` background, `muted` text,
a 1.5 px `line` inset ring, no press animation (`.btn-primary:disabled`,
`client/src/fx.css`).

**The nine screens are fixed.** These joins and shortcuts are tempting and each
breaks the instrument:

- valence + arousal on one screen (two sliders or a 2-D pad): it inflates their
  correlation; one default point loses each field's `untouched`; it is a new
  control (methodology.md §2.1, methodology.md §5.4);
- intensity + body: on a phone the slider would sit under a scrolling 21-option
  grid, so `untouched` would rise for layout reasons; on a null body it makes
  the null cheaper (methodology.md §2.7);
- urge + head_mode: two time anchors ("now", "just before you opened Emo") on
  one screen undo the attention anchor, and 13 options plus a slider do not fit
  375×667;
- word + urge: it couples LEAS levels 2 and 3 (methodology.md §2.8) and breaks
  word/urge comparability;
- head_mode + context: it couples two answers the methodology analyses against
  each other (methodology.md §4), and a stop there loses three groups;
- auto-advance after a single choice: a habitual Next then skips the next slider
  unseen, and speed would depend on the answer path;
- skipping steps by earlier answers (e.g. intensity after a null body): it makes
  null answers cheaper;
- device-dependent screens: a device-dependent instrument (§1.11).

Any join amends data.md §4, bumps `ui.copy`, documents what a "Stop here" on the
joined screen loses (`stopped_at`), and passes the null-visibility e2e at
375×667. The form asks the word (6) before the urge (7), which differs from
methodology.md §2.8's body → urge → word; that order is a methodology question,
not a layout one.

### 6.3 Ways out

- **The exits row** sits in the footer over the right end of Next: the text link
  **"Skip check-in"** (`common.skipCheckin`) on step 1, **"Stop here"**
  (`checkin.stopHere`) from step 2 on, then **Close**, an **×** icon button
  (44×44, `aria-label` "Close — you can continue later") in the corner. The two
  are never adjacent look-alike links. They come after Back / Next in the focus
  order, so Tab out of an answer still lands on Next. On steps 1–2 the row
  starts with the selection summary at the left. A stray tap costs one tap:
  Close keeps the draft (Continue), Stop here leads to Saved with Undo.
- **Skip check-in** (step 1) and **Stop here** (steps 2+) save
  `skipped=true,
  abandoned=false` with `stopped_at` = the step on screen
  (data.md §3.6; `machine.toStoppedEntry`). The answers of the steps **before**
  it are kept as they were confirmed with Next; that step and every later one
  are `null` (on step 1 nothing is kept). `untouched` lists only the untouched
  sliders of the kept steps; `ui` is present on a stopped entry at any step,
  step 1 included, and on an abandoned one. → Saved, the same as for any
  check-in. A save that storage refuses keeps the form on its step (§6.13).
- **Close** keeps the draft and marks it `closed_by_user: true`, so it waits on
  Home behind "Continue" / "Skip it" (§3.3) and in the History gate (ui.md
  §15.14); opening it again clears the mark. The browser's (Android's) Back
  leaves the form the same way. "Skip it" on Home or in History ends the draft
  as Stop here would on its step.
- **Resume:** at app start the draft reopens on its step only when the person
  did **not** close it (a reload, an eviction, the OS killing the app); a closed
  one never reopens by itself, also when the app starts on `/now`.
- **Nothing to keep:** a check-in the person started (`manual`, `after_event`)
  and closed — or left to the abandon rule — with **no interaction at all** (no
  answer, no Next or Back: `last_interaction_at = started_at`) leaves no record:
  the draft is dropped (`machine.discardable`). One opened from a reminder
  (`random`) keeps its record, because an unanswered reminder is compliance data
  (methodology.md §1.1, methodology.md §5.3).
- **Abandon:** the rule depends **only** on time. When
  `now − last_interaction_at ≥ 10 min` (`ABANDON_AFTER_MS`) at a check (app
  start, `visibilitychange → visible`, a timer while the app is visible), the
  draft is finalized as `skipped=true, abandoned=true` with `stopped_at` = the
  step on screen and the answers before it kept, as for Stop here (a partial
  dose is data). `ts` = `last_interaction_at`, `latency_sec` from `started_at`
  to it, `trigger` and `reminder_id` as they were. Otherwise the form resumes on
  the same step — also after the app was closed or reloaded (iOS often unloads a
  PWA in the background; that must not cost the answer), unless the person
  closed it.

### 6.4 The draft and the record

- The machine state is written to IndexedDB as the draft after every change —
  **encrypted with the DEK** and padded (store `draft`, AAD architecture.md
  §5.5); no plaintext reaches disk. Without the DEK the draft lives in memory
  only. It holds `started_at`, `last_interaction_at`, the summed `hidden_ms` and
  `hidden_since` (when the app last went to the background).
- **One tab owns the draft** (Web Lock `emo-draft`,
  `client/src/lib/draftLock.ts`; reliability.md §1.3); a second tab shows the
  other-window screen (§6.15).
- `latency_sec` = wall time from step 1 first shown to save; `hidden_sec` = the
  part of it the app was in the background. Both by the wall clock
  (`Date.now()`, surviving a restart), whole seconds, never shown to the person
  (data.md §2).
- `untouched` is filled by the machine: a slider that got no input is listed,
  and its value is the midpoint (`MIDPOINT`: intensity, arousal, head_mode 5;
  valence 0). Next waits for a touch, so this happens only for a resumed draft
  or an entry reopened by Undo.
- `ts` is set at save, by the device clock, UTC. `tz_offset_min` =
  `-new Date().getTimezoneOffset()`.
- **`ui`** (the controls, the copy version and the layout, data.md §3.6) is
  written to the draft each time the form opens (`openCheckIn`) and merged with
  the current one (`machine.mergeUi`): `copy` stays the one the draft started
  with (also after an app update and after Undo), the other fields are as now; a
  different layout makes `layout = "mixed"`, which stays
  (`machine.mergeLayout`). While the form is open, a layout change (turning the
  phone, resizing the window) is merged into the draft the same way
  (`machine.recordLayout`; not an interaction). At save the draft's `ui` is
  merged with `currentEntryUi()` again.
- **Layout values** (`currentLayout()`, `client/src/lib/theme.ts`): `wide` for a
  window from 900 px, otherwise `phone`, or `short` for a phone whose
  keyboard-free layout-viewport height is under 500 px. That height is held
  while an on-screen keyboard is up (`keyboardFreeHeight`, §4.3), so typing
  never makes an entry `mixed`; only turning the phone does. `layout.short`
  reads the same, and `theme.onLayoutChange` reports only a real layout change.
- Save pipeline and sync: architecture.md §7.1.

### 6.5 Common step layout

- The progress (segments, bar, rule or dots per theme, ui.md §14.4) is
  `aria-hidden` and announced as "Step N of 9" (§5.6); themes with a step label
  show "{nn} / 09 — {label}" (`checkin.progress.counter`).
- No emoji, no mood icons, no streaks, no counters of missed check-ins on any
  screen (methodology.md §2.14).
- Headings: 28 px, weight per theme (the editorial heading style: 40 px, ui.md
  §14.4); hints 15 px `muted`.
- **Carry line:** from step 2 on, a muted line above the title names what was
  answered so far ("shoulders, chest"; on step 3 "shoulders, chest — warm,
  pulsing, tense"; or "nowhere", "whole body"). It is the h1's
  `aria-describedby`. Context only, no data.
- **Answer grids:** 2 columns in dictionary order in every theme (§1.11;
  desktop: auto-fit, §9). The `grouped` layout and its group labels are reserved
  (ui.md §14.4).
- **Single-slider screens** (steps 3, 4, 5, 8) **and the urges** (step 7): the
  question and its answers are one group at the bottom, just above the footer —
  carry line, title, hint or help link, then the slider or the grid — so the
  thumb rests next to Next, with the free space above. The hint "Tap the slider
  where it is" sits right over the slider. A question too long for a short
  screen scrolls from its top.
- The slider is the one of ui.md §14.4 in every theme
  (`components/common/Slider.svelte`): no number, no fill. Untouched it is a
  dashed, unlit thumb at the midpoint that never moves, with no note under it;
  the first input lights it and sends one ring out ("set"), the same at any
  value.

### 6.6 The help link and help sheets

- Steps 2, 6, 7 and 9 end their hint line with " · **About these words**"
  (`checkin.help.words`); steps 3, 4, 5 and 8 show "**About this question**"
  (`checkin.help.question`) — at the end of the hint where there is one (step 8,
  and step 3's "Nothing to rate?"), else in a hint-styled line of its own in the
  hint's place. Nothing on step 1: the figure defines the zones (`HELP_OF`,
  `client/src/lib/help.ts`).
- It is a text button in the hint's size and `muted` colour, underlined, mono
  where the theme's labels are, never the accent. It is 44 px high through
  vertical padding and an equal negative margin, so the line does not grow. On a
  phone it ends at the right edge: on the hint's line when it fits, else on a
  line under it, without the " · ".
- It opens a read-only `ConfirmSheet` (Close only; the title is the step's plain
  title):
  - step 2: all qualities;
  - step 6: the level-1 words, then "How sure are you of the word?" with the
    three certainties, then — only when a level-1 word other than "don't know"
    is chosen — "More precisely (optional)" with that word's level-2 terms;
  - step 7: the urges; step 9: the situations;
  - a slider step: one paragraph on the question and its poles.
- Each term is its label and a one-to-two-sentence description
  (`shared/glossary.ts`, drafts pending review). Nothing in the sheet is an
  answer.
- **Not an interaction:** opening and closing call no form function, do not
  touch `last_interaction_at` and do not re-save the draft, so `discardable()`,
  the abandon rule and every timing field keep their meaning. Help use is not
  recorded in entries.
- While the sheet is open, →/←/PageUp/PageDown do nothing. Esc, Close or a
  backdrop tap closes it, and focus returns to the link. For 350 ms after it
  closes, a transparent shield takes every tap. The same on every device and
  theme: no hover tooltips, no per-option icons, no long press on options.
- The descriptions follow binding rules, tested in `shared/glossary_test.ts`
  (copy.md §8.3; data.md §5): no label of the term itself, causes, meanings,
  norms, frequency, coaching or clinical words; near words told apart by object,
  time, direction and spread, never by a body zone, the scales of steps 3–5 or
  another step's labels; null answers are full answers and told apart.

### 6.7 Step 1 — Where in the body?

Detailed in §7.

- Title "Where in the body?"; hint (theme-dependent) "Mark where you notice
  something" — an invitation to notice, not a selection task. Until the device
  holds its first check-in (saved or skipped), the hint is instead "About a
  minute. “Nowhere” and “don't know” are answers too."
  (`checkin.step.1.hint.first`): predictability and permission before a
  body-focused task. Never on Home, where a block of text would push Now down.
- The figure in the height that is left, the Front/Back switch centred under it;
  **Whole body** / **Nowhere**, one row of two 44 px pills, pinned in the footer
  with the selection summary under them, as on step 2 (§7.1).

### 6.8 Step 2 — What is it like?

- Hint "Choose any that fit". Multi-select from `QUALITIES` (data.md §5.3).
- `nothing` and `cant_tell` are **exclusive**: selecting one clears the others;
  selecting any other clears them.
- The sensation words stay in dictionary order in the grid, which scrolls inside
  `main`; **"nothing / can't tell"** render as a **pinned pair** at the top of
  the footer, just above the summary — the same 44 px pills as step 1's Whole
  body / Nowhere (`NullPair.svelte`) — so both are on screen however long the
  list is (§1.4).
- **Summary** at the left of the exits row: "Chosen: tight, lump" / "No choice
  yet" (no count, and no echo of the option "nothing"); with a null answer,
  "“Nothing” is an answer too." / "“Can't tell” is an answer too." — validated
  where it is given. A phone shows it without scrolling.

### 6.9 Steps 3–5 and 8 — the sliders

- **Step 3 — How strong is it?** (`body.intensity`, 0–10). Poles "barely there"
  ↔ "very strong". When the location is nowhere or the qualities are only
  "nothing" / "can't tell", the hint reads "Nothing to rate? Tap the slider
  where it is." (`checkin.step.3.hint.null`). Never "Anything at all in the
  body?", which leads away from the null answer.
- **Step 4 — Overall: unpleasant or pleasant?** (`affect.valence`, −3…+3).
  "Overall:" anchors core affect to the state as a whole, not one sensation
  (methodology.md §2.1). Eyebrow and History label: **TONE** (never "valence",
  clinical jargon). Always a **bipolar slider** with a visible centre tick (2×32
  px, `muted`). Poles "unpleasant" · "neutral" (centre label) · "pleasant".
  Untouched → 0.
- **Step 5 — How charged is the body?** (`affect.arousal`, 0–10). Poles "low
  charge, slowed down" ↔ "high charge, revved up": neither pole is unpleasant,
  so valence and arousal stay independent (methodology.md §2.1).
- **Step 8 — Just before you opened Emo, where was your attention?**
  (`head_mode`, 0–10). Hint "Busy with something outside? Put it where it fits
  best." Poles "here, in the body" ↔ "in my head, in thoughts". The recall is
  anchored to an event every check-in has — opening Emo — never "when the
  reminder came", because manual check-ins have no reminder. Body first
  (methodology.md §2.8).
- **Touch** (`client/src/lib/press.ts`): Next waits for a first input. A still
  tap is one: let go within 10 px of where it went down (`STILL_PX`) and not
  taken by a scroll or zoom; on the thumb (within 22 px, `THUMB_REACH_PX`) it
  answers the midpoint, elsewhere on the track the value under the finger. Space
  / Enter answers the midpoint. A scroll, pull or pinch that starts on a slider
  never answers it, and a value the browser set at such a press goes back at
  once. An untouched slider saves the midpoint and is listed in `untouched`
  (§6.4).

### 6.10 Step 6 — Is there a word for it?

(`affect.word`, `word_confidence`; `components/flow/StepWord.svelte`)

- Hint "Optional. One broad word is enough — then how sure you are."
- Level 1: 8 options (fear, anger, sadness, shame, joy, surprise, empty, don't
  know), identical styling, "empty" and "don't know" included.
- After choosing a level-1 word (not "don't know"), reveal in place, in this
  order, so the required part is never under a long chip list:
  - "How sure are you of the word?" — **guessing · sure · can't say** (required
    to continue), directly under the level-1 grid. "can't say" is the stored
    `unknown`; the label differs from the level-1 "don't know" on the same
    screen;
  - "More precisely (optional)" — chips of level-2 words (single select, tap
    again to clear).
- Without a certainty, Next looks disabled (`aria-disabled`), but a tap (or →)
  scrolls the certainty into view and a live line under it says "Choose how sure
  you are".
- "don't know" → `word = "unknown"`, `word_confidence = "unknown"`, and the line
  "“Don't know” is an answer too. Nothing more needed here."
- Tapping the selected level-1 word again clears the word, level 2 and the
  certainty.
- Stored value: `"fear"` or `"fear.anxiety"` (keys, data.md §5.4).

### 6.11 Step 7 — There is an urge to…

(`urge`) Hint "One option, optional". Single select, tap again to clear. Low on
the screen with its question, as a slider is (§6.5); nothing on it grows when
chosen.

### 6.12 Step 9 — What is the situation?

(`context_tag`, `context_other`, and the optional `note` under it;
`components/flow/StepContext.svelte`)

- Hint "One option". Single select (required).
- Selecting **other** reveals below the grid: label "Which situation?
  (optional)", a text input 52 px high, placeholder "a word or two", a counter
  "N / 40", at most 40 code points (`CONTEXT_OTHER_MAX`), autocomplete and
  autocorrect off, **focused at once** (§5.5). Deselecting "other" hides it but
  keeps the typed text until save; it is saved only if `context_tag = other`.
- Under the grid (and the "other" field): the note (§8). "Save without the note"
  saves at once when a situation is chosen; otherwise it clears the note and
  Save waits for the situation.

### 6.13 Not saved

When Save, Stop here or Skip check-in fails (a storage error), one line appears
in the footer above the exits row: "Not saved. Try again."
(`checkin.save.failed`, `role="alert"`, 15 px ink). The footer grows upward, so
Next, Back and the ways out stay where they are. The answers and the draft are
kept, and the next tap tries again. A step change clears the line. Diagnostics
event `checkin.save_failed` (reliability.md §1.8).

### 6.14 Saved and Undo

- **Saved** (`components/flow/SavedScreen.svelte`): a centred 56 px check mark
  (circle stroke accent, tick stroke ink), "Saved" 22 px / 500, `role="status"`,
  and under it one muted line (15 px): **"You can go back to what you were
  doing."** It orients and evaluates nothing (no thanks, no praise). The status
  stays centred in the space above the footer.
- Two buttons in the check-in's footer row: **"Done"** (filled, returns home
  now) where Save was — 56 px high, the row's remaining width, so the thumb that
  just saved is already on it — and **"Undo"** (outlined, 56 px) at its left,
  where Back was. Done is first in the focus order.
- A tap anywhere else on the screen also returns home; otherwise it returns by
  itself after 5 s (`SAVED_MS`).
- **The same screen for every check-in** — saved, stopped or skipped, whatever
  the answers: no answer-dependent ending, no different wording, no shaming.
  Back home, focus lands on Now (§5.5).
- **The Home toast.** Home then offers Undo in a toast ("Saved · Undo") above
  the pane dots, so it never covers the navigation, until 10 s (`UNDO_MS`) after
  the check-in reached Home (Saved done, or "Skip it"). It never lasts past 15 s
  after the save (Saved's 5 s plus 10 s): a Saved screen that stood longer, its
  timer stalled by a hidden page, never hands Home a fresh 10 s. If the page
  went hidden while Saved was showing, Home offers no Undo at all. This is an
  absolute wall-clock deadline (`client/src/lib/lastSaved.ts`), never paused or
  restarted. Leaving Home, a lock, starting a check-in or the page going hidden
  ends it, and coming back to Home never shows a fresh 10 s. A "Skip it" in
  History goes the same way: its Undo shows on Home only for what is left of its
  10 s. The toast's Undo is armed only once the toast has risen in (§5.2).
- **Undo** removes the local entry and re-opens the form at once. The tombstone
  and the queued `delete` that replaces any pending upload in the outbox are one
  storage write, and it never waits for a sync pass, even one still sending this
  check-in (architecture.md §8.3 step 1). The background sync pass sends
  `DELETE /api/entries/:id` with `X-Emo-Auth` proof; Undo never waits for it, so
  a slow or stalled request never holds Saved or the toast.
- **Undo failed.** If storage refuses the deletion, the check-in stays saved,
  never half deleted: the buttons come back, one line above them reads "Couldn't
  undo — the check-in is still saved." (`checkin.saved.undoFailed`,
  `role="alert"`, 15 px ink, centred), and the 5 s start again. Diagnostics
  event `checkin.undo_failed`.

### 6.15 Another window

When `/now` opens in a second tab while another tab holds `emo-draft`
(reliability.md §1.3), the screen shows "A check-in is open in another window."
(`checkin.otherWindow`) centred, then the check-in's footer row. "Go to it"
(`checkin.otherWindow.focus`, primary) sits at the right where Next is: it posts
`draft-ping` on the `BroadcastChannel`, and the tab with the form calls
`focus()`. "Close" (`common.close`, secondary) sits at its left where Back is
and goes home. The same on a desktop.

## 7. Body map

`components/flow/BodyMap.svelte`; geometry in `client/src/lib/bodyFigure.ts`
(`PATH`, `BANDS`, `SEAMS`, `DETAILS`, `HITS`, `ZONE_ORDER`), tested by
`bodyFigure_test.ts`. Zone keys and labels: data.md §5.2.

### 7.1 Layout (step 1)

One large figure with a **Front / Back** switch, a continuous silhouette, no
dashed phantom zones, a selection summary in text and a Next button that names
the selection.

```
Title  "Where in the body?"
      (figure, fills remaining height, max 260×520 at 1×)
          [ Front · 2 | Back · 1 ]   segmented tabs, 44 px, ≤ 240 px, centred; badges: §7.4
──── footer ────
( Whole body )  ( Nowhere )       2 equal pills, 44 px, the footer's width
Selected: throat, chest   Skip check-in  ×    summary 15 px, aria-live
[ ‹ ]  [ Next: throat, chest → ]
```

- On a phone every control but the zones is under the thumb. The switch stays
  first in the focus order, the tabs before their panel (`role="tablist"`,
  `role="tab"`, `aria-controls`).
- Default view **Front**.
- The figure sits in a stage that takes the height left (`flex: 1`, a size
  container): its height is `min(stage, 520px)` and the SVG scales to fit
  (`viewBox`, `preserveAspectRatio="xMidYMid meet"`). It never drops below 85 %
  of 520 px (442 px): on a shorter screen `main` scrolls under the figure
  instead, while the null pills in the footer stay in view (§1.4). The reach
  contract's exception (a) instead keeps the whole figure on screen with zones
  down to 36 px (§4.5); step 1 meets it at 390×844, and the other sizes are
  listed in `PENDING` (§4.9).
- Swiping on the figure navigates steps; it never flips the view (§5.3).

### 7.2 Silhouette and zones (viewBox `0 0 260 520`)

The coordinates live in `client/src/lib/bodyFigure.ts`; it is the source of
truth, and this section states the rules it follows.

- **Silhouette** (`PATH[view]`): one closed path, a neutral standing figure of
  the medical-chart kind, about seven heads tall in natural proportions,
  gender-neutral, no face. Drawn as its left half from the crown (130, 4) to the
  crotch (130, 280) in cubic Béziers and mirrored around x = 130. Arms hang
  clear of the torso, hands relaxed with the fingertips at mid-thigh; feet reach
  y 516. Front and back share the outline except for the base of the head (a
  chin from the front, the round back of the skull from behind) and the feet (a
  forefoot turned slightly out, or the narrower heel).
- **Zones** (`BANDS`, paths clipped to the silhouette) are body-shaped, and
  their borders are the body's own lines (the face curve ear to ear, the
  collarbones, the deltoid's edge, the ribcage's arch, the waist, the belly
  line, the hip creases; on the back the line of the shoulders, the waist and
  the folds under the seat). Where a zone stops at the side of the torso it ends
  in the gap between the arm (or the hand) and the torso (`GAP`), outside the
  silhouette, so it never paints a sliver of the arm.
  - Front only: `forehead_eyes`, `jaw`, `throat`, `chest`, `solar_plexus`,
    `belly`, `lower_belly`. Back only: `head_back` (the whole head), `neck`,
    `upper_back`, `lower_back` (the seat is in it). Both views: `shoulders`,
    `arms_hands` (to y 335), `legs_feet` (everything below the hips, and below y
    335).
- **Drawn borders** (`SEAMS`, clipped, 1.25 px `figureLine` at ~42 %, round
  caps) follow those lines. Borders that run through the solid shoulder
  (collarbone → armpit) or down the seat's outer edge are not drawn; the fill
  shows them. Cross-body lines sag a little in the middle, as lines wrapping a
  body do. No seam at the chin or around the neck: the silhouette narrows there.
- **Interior marks** (`DETAILS`, 1.2 px `figureLine` at ~32 %, round caps) are
  fainter than the borders and stop ≥ 3 units short of one: the belly button and
  the kneecaps in front; the spine (broken at the shoulder line and the waist),
  the cleft of the seat, the creases behind the knees and the Achilles tendons
  behind.
- **Rendering order:** (1) the path filled `figure`, no stroke; (2) zone fills
  clipped to the silhouette (`clipPath` of the path); (3) the borders, clipped
  too; (4) the interior marks; (5) the path stroked `figureLine` 2 px on top,
  round joins, no fill (the contour stays continuous over the thumb and the gap
  between the legs).
- **Fills:** a selected zone fills solid in the fixed highlight (`figureSel`,
  §1.7). A zone fills and empties in the same 140 ms (no reward asymmetry).
  Hover and keyboard focus tint the zone's shape in the SVG (`figureSel` at ~10
  %), not the button's box; the focused button keeps its focus ring. The figure
  never glows, wobbles or lights up: it is the instrument.
- The 44 × 88 History glyph uses the same path, strokes 5 units (≈ 0.85 px) and
  draws no borders or marks (ui.md).

### 7.3 Hit targets

`HITS`: real buttons absolutely positioned over the SVG at the same scale.

- Each zone's first target is ≥ 44 units tall (≥ 44 px at 1×) and the only one
  assistive technology sees; its other targets are `aria-hidden` and
  `tabindex="-1"`, follow the curved borders more closely and sit under it in
  the page.
- Where two zones' targets overlap, the later zone in `HITS` wins, but never
  over another zone's centre (`bodyFigure_test.ts`).
- The narrowest first targets are 36 units wide (neck, solar plexus), which is
  why the reach floor is 29.5 px wide at 36 px tall (§4.5).

### 7.4 Selection rules

(`machine.toggleLocation`, `machine.toggleLocationKeeping`)

- Tap a zone → toggle it; it clears **Whole body** and **Nowhere**.
- **Whole body** → `locations = ["whole_body"]`, clears the zones; the whole
  silhouette fills with a light tint (`figureSel` at ~33 %, the outline in the
  highlight within 180 ms, the seams lighter). Tap again → clear.
- **Nowhere** → `locations = ["nowhere"]`, clears the zones and whole body. Tap
  again → clear. Storing the explicit `nowhere` key removes the ambiguity
  between "nowhere" and "not answered" (data.md §3.3); readers treat `[]` in old
  data as nowhere.
- **Nothing is lost by a mis-tap:** while step 1 is on screen, Whole body /
  Nowhere set the zones chosen so far aside, and turning them off again (also
  after switching from one to the other) gives those zones back. A zone tap
  while one of them is on starts a new choice. This lives in the form only:
  leaving step 1 forgets it, and saved data are unchanged.
- A zone that appears in both views (shoulders, arms, legs) is one key; its
  selection shows in both views. **Badges never count it twice:** the tab of the
  view on screen counts every selected zone that view shows; the other tab
  counts only the selected zones that view alone shows. The two badges always
  add up to the selection (and to "Next (n)"). The badge is `aria-hidden`; each
  tab's name says "Front, 1 selected" and contains its visible text (WCAG
  2.5.3).
- ←/→ on the tabs switch the view and never change the step (§5.4).

### 7.5 Selection summary

The selected body parts are always spelled out in text under the figure (in the
footer on a phone, in the right column on a desktop, §9), `aria-live`.

- Zones: "Selected: <labels in canonical order>"
  (`checkin.step.1.summary.selected`), canonical order = `ZONE_ORDER`:
  forehead_eyes, jaw, head_back, throat, neck, shoulders, chest, solar_plexus,
  belly, lower_belly, upper_back, lower_back, arms_hands, legs_feet.
- Whole body → "Selected: whole body".
- Nowhere → "“Nowhere” is an answer too." (`checkin.null.nowhere`).
- Nothing → "Nothing marked yet" (no "Selected:" prefix).

### 7.6 Next label on step 1

- nothing selected → "Next" (disabled)
- nowhere → "Next: nowhere →"
- whole body → "Next: whole body →"
- 1–2 zones → "Next: throat, chest →"
- ≥ 3 zones → "Next (3) →"

The label truncates with an ellipsis and never wraps.

## 8. Note field

The optional note sits under the situation grid on the last screen (§6.12):
`components/flow/StepNote.svelte`; the validator is `findStopPhrase` and
`validateNote` in `shared/entry.ts`.

### 8.1 The field

- The visible label "One fact, one line" (16 px / 600) and the hint "Optional.
  What and where — not why" (15 px muted), both tied to the field
  (`<label for>`, `aria-describedby`).
- A textarea, min-height 88 px, 17 px text, placeholder "e.g. call, kitchen, 15
  minutes", counter "N / 160" (code points), autocomplete, autocapitalize and
  spellcheck off, **never focused by itself** (§5.5). Ctrl/⌘ + Enter in it
  saves.
- Length is counted in code points (`Array.from(s).length`), max 160
  (`NOTE_MAX`). Input is truncated by code points (`machine.cut`), not by
  `maxlength`.

### 8.2 The validator

- It rejects fragments of the abstract mode — causes, meanings and
  self-evaluating "why" questions — not hedges: "maybe" and "I think" are
  tentativeness, close to the certainty "guessing" (methodology.md §2.10).
- The stop-phrases of all three languages are in `shared/i18n/note-stopwords.ts`
  (`STOP_PHRASES`). The **union of all three lists** applies whatever the
  interface language: a person with a Ukrainian interface may write in Russian,
  and cross-language false positives are unlikely. The lists grow only through
  code.
- Matching is case-insensitive on Unicode word boundaries; a letter or an
  apostrophe next to the phrase is not a boundary (`бокс` does not contain `бо`,
  `Whyte` does not contain `why`). Apostrophes (`'` and `’`) count as word
  characters and `’` matches `'`. The regex:
  `new RegExp("(?<![\\p{L}'’])(" + phrases.map(escape).join("|") + ")(?![\\p{L}'’])", "iu")`.
- It runs on every input. `findStopPhrase` returns the first phrase as typed and
  where it starts.
- Standalone uk `тому` is **not** in the list: it also means "ago", and the uk
  placeholder ("15 хвилин") invites exactly "15 хвилин тому". The causal
  `тому що` is in it.
- Known rare false positives, accepted: ru `из-за` in its spatial sense ("из-за
  стола"), en `means` in "by means of".
- Must-pass and must-reject corpora: `shared/i18n/note-stopwords_test.ts`; they
  grow with the lists.

### 8.3 On a match

- The message quotes the phrase as typed: "“because” is about why. Keep what and
  where — or save without the note." (`checkin.step.10.validator`). It sits in
  an `aria-live` callout under the field — ink text on a `surface` card with a 3
  px ink rule at the left — unlike the muted hint; it is scrolled into view
  (never focused) when it appears.
- The field's border turns 2 px ink, dashed (a warning, not an error; unlike the
  focus ring; no halo, no colour); `aria-invalid="true"`.
- **Save stays disabled** while the phrase is there; the text is kept for
  editing.
- Two ways out: a primary button **"Remove “because…”"** cuts the note from the
  phrase to the end (and the comma or dash before it), keeping the concrete
  part, and returns focus to the field; a secondary **"Save without the note"**
  saves with `note = null`.
- Saving a note with a stop-phrase is impossible, but the person is never
  trapped on the last step: the way out without the note is one tap.
- Diagnostics counters, no text (reliability.md §1.8): `note.rejected` (the
  validator fired), `note.rejected_resolved` (the note was saved after an edit),
  `note.rejected_cleared` (the note was removed, saved without, or skipped).

### 8.4 An input rule, not a schema rule

A saved note is checked for length only (≤ 160 code points, `validateEntryV2`),
so a later change of the stop-list never invalidates an entry already saved.

## 9. Desktop

At ≥ 900 px:

- **The pane bar** (§2.3): the wordmark and sync dot at the left of the 680 px
  column, the pane tabs (segmented, 44 px targets) flush right against it,
  sticky with a hairline once content scrolls under it. No swipe hint; Esc
  returns Home.
- **The check-in:** form column max 680 px; options
  `repeat(auto-fit, minmax(190px, 1fr))` (`OptionGrid.svelte`). Headings as on a
  phone (§6.5).
- **Step 1 in two columns:** the figure on the left (260 px, the height left,
  never below 442 px); the Front/Back switch, Whole body / Nowhere and the
  selection summary on the right (up to 320 px), the summary there instead of in
  the footer.
- **Keyboard legend** in the check-in footer (13 px muted, centred,
  `aria-hidden`), shown only with a fine pointer that can hover: "← → back /
  next · Tab move between options · Space select · Ctrl + Enter save note"; on
  Apple platforms "⌘ + Enter" (`a11y.keyboardLegend`,
  `a11y.keyboardLegend.mac`).
- Hover states on all options (border → ink). A mouse drag on the figure does
  nothing special, and a mouse never swipes (§5.3).
- Sheets stay bottom sheets at 90dvh (§4.7). The reach contract and the reach
  room do not apply.

## 10. Accessibility

Acceptance criteria; every release meets all of them.

- All interactive elements are native `button`, `a[href]`, `input`, `select`,
  `textarea`; no clickable divs.
- Every target is ≥ 44×44 px. Body zones are ≥ 44 px tall at 1× and scale with
  the figure; the figure never shrinks below 85 % of 520 px tall — the step
  scrolls instead (§7.1). Under the reach contract's exception (a) the whole
  figure stays on screen and its zones may scale down to 36 px tall (29.5 px
  wide for the narrowest) (§4.5).
- **Reach (phone):** at rest every control is in the thumb band, the instrument
  exceptions are whole on screen, and every primary, nav, pin and dock control
  is reachable at its centre. Checked by `e2e/audit.e2e.ts` (§4.10), with the
  known exceptions of `e2e/reach_pending.ts` (§4.9).
- **On-screen keyboard (phone):** the focused field and its submit are whole on
  screen, right above the keyboard (each ending within 120 px of it), and Return
  moves to the next field or submits from the last (§4.7, §5.4).
  `e2e/audit.e2e.ts` checks it in every rest state with a field.
- Contrast ≥ 4.5:1 for all text in all presets (the presets are tested, ui.md
  §14.6).
- Visible focus ring (§5.5); logical tab order (header skip → content → footer).
- A step change announces the question; summaries are live regions (§5.6).
- The full flow is possible with the keyboard only and with VoiceOver/TalkBack.
- Reduced motion honoured: every animation, transition, View Transition and
  script-driven arrival off, every effect in its still end state (§5.1).
- More contrast and forced colours: every light effect off; selection still
  reads from fill, weight and `aria-pressed`.
- Light never over text: sheens clear of 30–70 % of a control's height, halos
  outside the box, no fading text in the check-in; ink, secondary text and the
  accent as text ≥ 4.5:1 over the moving background.
- Colour is never the only signal (selected options also change weight, show a
  radio dot or `aria-pressed`; the sync dot differs by shape, §3.4).
- Modal sheets and overlays have `role="dialog"`, `aria-modal` and an accessible
  name (the new-recovery-key overlay included); Back closes the top sheet
  (§2.5). Each takes the focus when it opens, keeps Tab inside and gives the
  focus back when it closes; the new-recovery-key overlay also makes everything
  behind it inert (ui.md §11).
- Repeated controls are told apart by name: a Show / Hide button carries its
  field's label ("Show — Repeat", ui.md §12).

## 11. Settings

Settings is the last pane, right of History (ui.md §2.2). It scrolls. Section
headers are uppercase, 13 px / 600 / .06em, `muted`; cards are `surface`, radius
16, rows separated by 1 px lines. A desktop uses the 680 px column (ui.md §9).
Copy: `settings.*` in `shared/i18n/keys.ts`. Code:
`client/src/components/settings/`.

### 11.1 Order and deep links

On screen: header · Reminders (ui.md §11.3) · Language (§11.4) · Appearance
(§11.5, one row until opened) · Devices (§11.6) · Data and keys (§11.7) ·
Invites (§11.8) · Words (§11.9, one row until opened) · About (§11.10). People
come here for a reason, most often reminders; a theme is chosen once, so
Appearance stays one row and never pushes Reminders down.

`#reminders`, `#appearance` and `#words` are deep links; the last two also open
their section. Deep links and focus land below the held heads
(`scroll-margin-top`, WCAG 2.4.11). On a phone every text action ends at the
right edge, and the pause choices and one-tap fixes are right-aligned (ui.md
§4.5).

### 11.2 Header and sticky heads

The title row: "Settings" (26 px / 500) and at its right end "Methodology"
(`settings.methodology`, solid underline), which opens `/methodology#<locale>`
in a new tab. Under it the hint "Swipe right or press ← for History": a swipe
right or ← goes to History; Esc and the pane dots go Home. No back chevron
(ui.md §2.2).

**Sticky heads** (`client/src/lib/sticky.ts`, shared with History):

- The title row (44 px) holds at the top: under the safe area and the offline
  band on a phone, under the pane bar on a desktop.
- A section's header (28 px; in History, a day's) holds under it while its
  section scrolls, and the next one pushes it off. In History an open record's
  row holds under the day header (ui.md §15.4).
- Heads are clear at rest, so the light behind the pane shows through. Once held
  with content under them they take a band of the page background across the
  screen: `ground` on a phone; on a desktop the page's own background fixed to
  the viewport, as the pane bar has.
- The hint scrolls away under the title.

### 11.3 Reminders

`SectionReminders.svelte`; schedule rules: architecture.md §9.1; permission
states: reliability.md §2.4.

- **Awake window**: two `<input type="time">`, default 09:00 – 22:00.
- **Per day**: stepper − N +, 1–6, default 3; buttons 44×44.
- **Notifications on this device**: a switch (52×32 track, 44 px target, on =
  accent).
- **Pause reminders**: three 44 px buttons, "1 day" · "3 days" · "1 week". While
  a pause runs the row reads "Paused until Sat 10 Oct, 14:00" with **Resume**.
  `PUT` / `DELETE /api/settings/pause`; the server sends nothing meanwhile and
  logs those moments as `paused`. A pause also shows as one quiet line on Home
  (ui.md §3).
- The note under the card (`settings.reminders.note`): at least 2 hours apart,
  random times, "If one comes at a bad moment, let it pass — nothing is
  counted."
- **Blocked notifications**: the card's first row, in ink
  (`settings.reminders.blocked`), with "How to allow". It opens a sheet with
  this browser's steps first (Chrome/Edge, Android, Safari on a Mac,
  iPhone/iPad, Firefox), the others under them.
- **Validation.** The window must hold the count: `(n − 1) × gap + 60 min`. When
  it does not, the two time fields get a 2 px ink border (never a colour) and
  `aria-invalid`; the message (`settings.reminders.windowTooShort`) takes the
  note's place under the card, in ink, as their `aria-describedby`; the one-tap
  fixes follow: "Use 09:00 – 14:00" (a long enough window from the same start,
  or to the same end) and "Use 1 a day" (the most that fit). Nothing above the
  stepper changes size, so a second tap on + never lands on a fix. Nothing is
  sent meanwhile.
- **Changes apply from tomorrow.** Today's remaining reminders that no longer
  fit are dropped; none are added. After a valid change, in ink: "Saved — from
  tomorrow. Today keeps only the reminders that still fit."
- **No copy yet.** With no settings cached on this device, the window, the
  stepper and the pause are disabled until the server answers; a failed request
  shows `settings.reminders.offline` in ink. When Emo can reach the server again
  (`network.ts`), the settings are fetched and the controls enabled. The
  notifications switch stays usable.
- A device with a cached copy never waits. A change made before the server
  answers stays: an answer to a request sent before the change is dropped, from
  the screen and the cache.
- Other quiet lines: `settings.reminders.needsInstall` (iPhone),
  `settings.reminders.noDevice`.

### 11.4 Language

A segmented radio group of three: English · Українська · Русский. A change sets
`<html lang>`, switches the strings and sends `PUT /api/settings { locale }`.
All three locales ship; dictionary labels may carry `review: "pending"` until
the owner reviews them (data.md §5.8). Locale mechanics: architecture.md §11.3.

### 11.5 Appearance

Inline, below Language: ui.md §13.

### 11.6 Devices

- Rows like "iPhone · Safari / this device", "Mac · Firefox / 2 h ago"; other
  devices have **Revoke** (44 px), which only stops that device's sync.
- Under the list, the text button **"Sign out on this device"**: ends this
  session **and wipes this device's local data**. With a non-empty outbox it
  first asks to confirm "Discard N unsynced check-ins". Sign out, lock and
  delete: architecture.md §4.3.
- On a signed-out device: "Signed out on this device" and **Sign in**.

### 11.7 Data and keys

1. **Export: JSONL, CSV, encrypted copy** opens a sheet: "Spreadsheet (CSV)"
   with "Add labels in: …", "Full data for analysis (JSONL)", "Reminder log
   (JSONL)", "Encrypted copy for another Emo server". After each download a
   status line ("Saved entries.csv"). Last, "What each field means" opens
   `/methodology#<locale>-s4` in a new tab. Formats: architecture.md §10.1.
2. **Change passphrase**: "Current passphrase", "New passphrase, 8 characters or
   more", "Repeat the new passphrase".
3. **New recovery key** ("The old key stops working. Save the new one."). The
   key shows in a full-screen dialog that Back does not close (ui.md §2.2); it
   takes the focus, keeps Tab inside, makes everything behind it inert, and on
   close returns focus to "New recovery key".
4. **Lock on this device**: forgets the key on this device only; session and
   encrypted entries stay; the passphrase is asked next time.
5. **Copy diagnostics** (reliability.md §1.8).
6. **Re-save keys**, only when the newest key data, written on another device,
   does not open here; it writes a fresh copy from this device (reliability.md
   §1.2).

Then the text button **Delete account** (dotted, ink). Its sheet has a
passphrase field; "Delete everything" stays disabled until the field has text.
The client unwraps the key locally, then calls `DELETE /api/account` with the
proof of key possession (architecture.md §4.5).

In the passphrase sheets Return moves to the next field and saves from the last
(ui.md §5.4); every passphrase field follows ui.md §12.6.

Quiet lines only when relevant (reliability.md §1): `{n}` entries need a newer
app / could not be decrypted (with `settings.data.unreadable.hint`), the clock
is N minutes off, storage nearly full, the server is older than the app.

### 11.8 Invites

Shown only when `INVITES_BY_USERS=true` (the default).

- Header right: "Joined: N", a count only; invitees are never named.
- Rows: the code in mono (`K7QM-3XPA-9TNE`, 15 px, .04em), the status under it
  ("joined Oct 3" / "not used yet" / "expired"). Unused rows have **Share** (Web
  Share API, else copy; the label then reads "Copied").
- Footer "+ Create code"; note "One code, one person. Valid for 30 days." Up to
  `INVITES_PER_USER` codes (default 5), then `settings.invites.limit`.

A user's code is good for **one person**; admins make multi-use codes from the
CLI (`make invite USES=10 EXPIRES=30d`). Sign-up is open by default
(`REGISTRATION=open`): a code is then optional and still counts as "Joined".
`REGISTRATION=invite` keeps the server invite-only. Server side: api.md §2.2,
architecture.md §4.4, ops.md §2.6.

### 11.9 Words

One row, "Words in check-ins ›" (`aria-expanded`), opening inline; `#words`
opens it. Inside: `settings.words.intro`, then the terms in check-in order under
the step eyebrows (BODY: whole body, nowhere · QUALITY · INTENSITY · TONE ·
CHARGE · WORD · URGE · ATTENTION · SITUATION), the same label and description
pairs as the in-check-in help sheet (ui.md §6.5; text in `shared/glossary.ts`).
Under WORD each level-1 word is a native `<details>`, closed by default, with
its description and level-2 terms, then "How sure are you of the word?" with the
three certainties. Read-only, no hover. (`SectionWords.svelte`,
`common/TermList.svelte`.)

### 11.10 About

The last section: plain text rows, no icons, never inside the check-in or as a
pop-up (ui.md §1.5, ui.md §1.9). Content from i18n (`settings.about.*`) and
`GET /api/instance` (api.md §2.11), cached in `meta.instance` so it works
offline. `AboutContent.svelte` is shared with the sign-in sheet (ui.md §12.2).

1. **Not a medical device**: it does not diagnose, treat or monitor any
   condition, and does not replace a therapist.
2. **Methodology & Principles**: one line, and "Read methodology guide" →
   `/methodology#<locale>`. That is `client/public/methodology.html` (also
   `/methodology`): the methodology in en, uk and ru without its personal
   context; static, script-free, precached, so it opens offline and without an
   account. Its mark links to `/`. On a phone (< 900 px) its mark and language
   switch are a bar at the bottom, the languages last at the right edge, and
   each "Contents ↑" ends at the right edge (ui.md §4.5); a desktop keeps them
   at the top.
3. **If things are hard right now**: contact local emergency services or a
   crisis line; "Find a helpline" → `crisis_url` (default
   `https://findahelpline.com`; the operator can set a local one).
4. **Privacy on this server**: a built-in summary of what the server can and
   cannot see (`settings.about.privacy.body`, from architecture.md §2.3). Then
   "Operator's privacy notice" → `privacy_notice_url` and "Contact the operator:
   {contact}", each only when set. A same-origin path (such as the built-in
   `/privacy.html`) gets `#<locale>`; an outside address is used as given
   (ops.md §2.6).
5. **Source code**: free software under the GNU AGPL, version 3 or later; "View
   the source" → `source_url` (by default the server's own source archive).
6. **Version**: "App X.Y.Z · Server X.Y.Z" ("—" while unknown); with an update
   waiting, "· update ready — Restart" (ui.md §3).

Emo is AGPL-3.0-or-later because users run the operator's JavaScript against
their own encrypted data and are entitled to the source of the exact version
they use (AGPL §13); the Source code row serves that. External links use
`target="_blank" rel="noopener noreferrer"` and are 44 px tall.

## 12. Auth and onboarding

Code: `client/src/components/auth/*`, one lazy chunk (`screens.ts`). Copy:
`auth.*`. Flows behind the screens: architecture.md §4.1, reliability.md §1.2,
reliability.md §1.3.

### 12.1 Common layout

- Padding 56–72 px top, 24 px sides; step label "Step N of 3" (14 px muted);
  title 28 px / 500; body 16 px / 1.45. The primary button is at the bottom of
  the card: 56 px, radius 16, `.btn-primary` (ui.md §14.4).
- **Phone**: the card sits at the bottom of the screen like a sheet, the free
  space above it. Its text links end at the right edge ("I have an invite code",
  "Change", "Resend", "Methodology", "About and privacy", "Use recovery key",
  Cancel, Back, Copy, "Suggest a passphrase"); Allow notifications is in the
  corner with "Not now" beside it; the language choice is under the sign-in
  card, at the right.
- **Phone, resting at the end**: the auth and unlock screens rest at the page's
  end. A card taller than the screen (375×667, or 390×664 under Safari's bars)
  never cuts off its primary button or its links. While at its end the page
  stays there as the card loads or grows (a meter, a hint, an error), unless the
  person scrolls away. Layout contract: ui.md §4.5.
- **Desktop**: the card is centred.
- Between the email and the code the card keeps its place: its size morphs and
  its content crossfades (ui.md §5.1). Sign-in screens carry the moving
  background (ui.md §13.7).
- Errors are 2 px ink, never a colour, with `aria-invalid` and
  `aria-describedby`. On arrival the first field is focused (ui.md §5.5).

### 12.2 Sign in — email

- Above the title: the mark (30 px, ui.md §16.2) beside the "Emo" wordmark
  (display font, 22 px / 600) and the tagline `auth.signin.tagline` (16 px
  muted), so the first screen says what Emo is. Not in "Sign in to sync".
- Email, then an invite field behind "I have an invite code", which focuses the
  field it opens (ui.md §5.5). Then "Send code".
- `novalidate`: an empty address or one without "@" shows "Enter your email"
  under the field (`aria-invalid`, focus on the field), never the browser's
  bubble.
- **Title**: "Sign in or create an account" on an open server
  (`REGISTRATION=open`, the default: the same email and code make a new
  account); "Sign in" on an invite-only one; "Create an account" on either while
  the invite field is open; "Sign in" on the code card.
- **Footer links** on every sign-in card: "Methodology" (a new tab; one short
  word, so the row fits one line on a sideways phone in every language) and
  "About and privacy" (ui.md §11.10 as a sheet), so people can read both before
  registering. Centred under a desktop card, at the right edge on a phone,
  "About and privacy" last.
- **Sign in to sync**: on a device that already holds an account (from Home or
  Settings), title "Sign in to sync", body `auth.signin.again.body`, no invite
  toggle, and two links: "Use a different account" (ui.md §12.4, before any
  code) and "Back" (to that account, data untouched).

### 12.3 Code from the email

On the same card, not a screen of its own.

- After "Send code" the email field gives way to "We sent 6 digits to
  p.y@example.com. The code works for 10 minutes." The address is **in full**
  (masked only in "Sign in to sync"), with **Change** (44 px) back to the email
  and invite fields, both kept.
- The code field: `inputmode="numeric"`, `autocomplete="one-time-code"`, mono 30
  px, letter-spacing .5em, height 64, the shared field focus. It is **focused
  when it appears** and **sends itself at 6 digits**; "Sign in" stays for a
  retry.
- "Resend in 0:42": a 60 s countdown from the request, then "Resend code". While
  mail is down: "Can't send a code right now. Try again in a minute." with a
  countdown.
- **Invite-only server**: with no invite sent, "No code? A new account needs an
  invite code." and "Add an invite code" (back to the email, kept, invite field
  open and focused); left out in "Sign in to sync". With an invite sent, 60 s
  later: "No email yet? Check the invite code — it may be mistyped or already
  used.", shown whether or not a mail went out. An open server ignores a
  mistyped invite and mails the code, so it shows neither note.
- **Any failed verification** shows one message, `auth.code.invalid`, and the
  field comes back empty and focused. Never show an attempts-left count or the
  server's text: either would reveal which emails have accounts (api.md §2.1).

### 12.4 One account per browser

`AccountSwitch.svelte` (reliability.md §1.3) replaces the sign-in card; focus
goes to the title.

- After a sign-in as another account: "Another account is set up on this
  browser" / "You signed in as p•••••son@example.com.". From "Use a different
  account": "Use a different account?".
- Then how many check-ins this browser holds for its account, how many are not
  on the server yet ("clearing this browser loses them"), and, muted, why: one
  account per browser, so two accounts' check-ins never mix; what is on the
  server stays (`auth.switch.*`).
- Primary **"Clear this browser and continue"**; with unsynced check-ins a sheet
  confirms "Discard 3 unsynced check-ins" first. Text link "Back".
- Clearing continues as the new account (passphrase or unlock) or to a plain
  sign-in. "Back" after a sign-in ends that session and returns to the device's
  own account.

### 12.5 Passphrase (Step 1 of 3)

- Body `auth.passphrase.body`: only you can open your check-ins; the server
  never sees the passphrase, so it cannot reset it.
- "Passphrase, 8 characters or more" with a 4-segment strength meter (accent
  segments) and a word (weak / fair / good / strong), then "Repeat".
- **Rule** (`shared/passphrase/validator.ts`): printable ASCII only
  (`[\x20-\x7E]`), at least 8 characters. The meter is informational and never
  blocks progress; a score ≤ 1 adds "Easy to guess. A phrase of several words is
  recommended."
- Non-ASCII shows at once "Use Latin letters, digits or symbols — switch the
  keyboard to English."; too short shows "English characters only, 8 or more"
  once something is typed.
- The information box (`--c-info`, 3 px `--c-focus` rule):
  `auth.passphrase.warning` (without both the passphrase and the recovery key,
  nobody can open the check-ins). Then Next.
- While the key is derived: "Preparing your key…", and after 3 s "This is slow
  on this device. It happens once." A browser that cannot run the KDF:
  `auth.passphrase.kdfUnsupported` (it needs about 64 MB). KDF: architecture.md
  §5.1.

### 12.6 Passphrase fields everywhere

Setup, unlock, recovery and every Settings sheet
(`common/PassphraseInput.svelte`, `auth/NewPassphrase.svelte`):

- A **Show / Hide** text button (44 px) inside the field's right end, named
  after its field for assistive technology ("Show — Repeat") by visually hidden
  text after the visible word, never `aria-label`, so the visible word starts
  the name (WCAG 2.5.3). Two on one screen are always told apart.
- The first field is focused on arrival. The meter shows **only while the value
  is valid**, never "good" next to an error. "Repeat" says "The two entries
  differ." only once left, or once as long as the first field.
- A **wrong passphrase stays in the field, selected**, so one typo is fixed
  without retyping.
- Return in the first new-passphrase field moves to Repeat
  (`enterkeyhint="next"`); in Repeat it submits once both match.
- **Username for password managers**: a hidden `username` field with the
  **normalised email** (trim → NFC → lower case), never the account UUID. It
  comes from this tab's sign-in, or from the encrypted prefs (`email`, written
  at registration and on the next sign-in of an older account, architecture.md
  §2.3) once unlocked, so it survives a restart. The unlock screen after a
  restart or lock cannot read the prefs and leaves the field out. Never store
  the address in plaintext to fill it there.
- **"Suggest a passphrase"** (a link under the hint) fills both fields with five
  random words from the EFF Large Wordlist (CC BY 3.0 US) minus words about
  pain, illness, death, violence or distress: 6968 words, about 64 bits, the
  meter's "strong". They show in full in a mono box under the field with
  `auth.passphrase.suggested`. The list (`client/src/lib/passphraseWords.ts`) is
  a lazy chunk fetched on that tap (performance.md §2).

### 12.7 Recovery key (Step 2 of 3)

`RecoveryKeyDisplay.svelte`; format: architecture.md §5.1.

- "Shown once. You need it if you forget the passphrase." The key card: 8 groups
  × 4 Crockford base32 in a 4-column grid, mono 18 px, a `--fx-inset` well, with
  Copy. If the clipboard refuses: `auth.recovery.copy.failed`; the next
  successful copy replaces it with "Copied".
- Three selectable cards (several allowed; each ≥ 64 px, a radio-like circle
  that shows a check when done):
  - **Save or share**: a file `emo-recovery-YYYY-MM-DD.txt` (Web Share or a
    download).
  - **Email it to me**: warning "Anyone who can read your email can read this
    journal"; after sending "Sent. The email has no links."; at most 3 a day,
    then `auth.recovery.email.limit`. On by default
    (`RECOVERY_MAIL_ENABLED=true`), but always a deliberate tap, never automatic
    (architecture.md §5.6).
  - **I'll write it down**: "8 groups of 4 characters".
- Next stays disabled until at least one is done.
- **Shown but never saved** (a reload, a crash, a closed tab): while
  `meta.recovery_pending` is set, the app opens "Your recovery key wasn't saved"
  and asks for the passphrase to issue a new key; the unsaved one stops working
  (`RecoveryPending.svelte`).

### 12.8 Step 3 of 3 — Install and reminders

`OnboardingFinish.svelte`.

- Title "Reminders" when there is nothing to install; "Install & reminders" with
  an **Install Emo** button when the browser offers it (`beforeinstallprompt`,
  kept from the app's first moment). iOS Safari not standalone shows the "Add to
  Home Screen" steps first.
- Under the title, the orientation before the first check-in
  (`auth.orientation`): about a minute; "Nowhere" and "don't know" are answers
  too; you can stop at any step. Step 1 of the first check-in repeats it in one
  line (ui.md §6.5).
- The body says how often Emo asks and "If one comes at a bad moment, let it
  pass — nothing is counted."
- "Allow notifications" (an explicit tap) and "Not now"; the awake window; Done
  → Home.

### 12.9 Unlock, new device, recovery-key entry

- **Unlock** (after a lock or a restart): the passphrase field and "Use recovery
  key"; body "Enter your passphrase to open your entries."
- **New device** (right after a sign-in on a browser without the account): "New
  device" / "Enter your passphrase to decrypt your entries here.", then
  "Downloading entries… {n}" during the first pull.
- Errors: "Wrong passphrase."; `auth.unlock.keyringDamaged` (try the recovery
  key); `auth.unlock.keysChanged` (enter the current passphrase). After 5 wrong
  passphrases each try waits 30 s, across reloads ("Too many tries. Try again in
  {s} s."): against shoulder-surfing only; Argon2id is the real protection
  (`client/src/lib/unlock.ts`).
- After unlocking or signing in the app opens **Home**, or the link that opened
  it (a notification, `/history`), never the pane open at lock or sign-out.
- **Recovery-key entry** (`RecoveryUnlock.svelte`), body `auth.recoverFlow.body`
  (a new passphrase and a new recovery key follow, so have a pen or password
  manager ready). One field, focused on arrival: 32 characters with or without
  spaces or hyphens, uppercase, grouped as typed; mono 18 px (at most 4.6vw) in
  **two lines of four groups** like the key card ("ABCD EFGH JKMN PQRS" / "TVWX
  YZ01 2345 6789"), so it matches what was written down and never scrolls
  sideways. `O`→`0`, `I`/`L`→`1` silently. The last 32 bits are a checksum: a
  typo shows "Check the key — 8 groups of 4 characters." at once, before any
  decryption; a key of another account: "That key does not match this account."

## 13. Appearance

Inline in Settings, no separate editor. `SectionAppearance.svelte`; copy
`settings.appearance.*`; the theme system: ui.md §14. Reference:
`design/prototype/Settings.dc.html`, `design/12-settings-appearance.png`.

### 13.1 Collapsed row and order

Under "APPEARANCE" the section is one `aria-expanded` row with the current
choice and a chevron, e.g. "Calm · Original ›" or "Dusk · Rose · gradient";
`/settings#appearance` opens it. Inside, in order: Match the system (ui.md
§13.2) · live preview (§13.3) · theme list (§13.4) · base colour and gradient
(§13.5–13.6) or the fixed-palette line (§13.10) · moving background (§13.7) ·
left-handed reach (§13.8) · status line (§13.9).

### 13.2 Match the system

"Match the system: Calm by day, Dusk at night": a switch (52×32 in a 44 px
target), **off by default**, hint `settings.appearance.auto.hint`.

- The app is light by default; dark appears only by explicit choice, a dark
  preset or this opt-in.
- On: Calm in light mode and Dusk in dark mode, in their own colours, following
  `prefers-color-scheme` live; the highlight stays fixed. The row reads "Calm by
  day, Dusk at night"; no card is checked; the base-colour card is hidden; the
  chosen theme and colours are kept for when it is off. Choosing a theme turns
  it off.
- Stored as `auto: true`. `/boot.js` gets both value sets, so a dark start
  paints Dusk before the app runs (ui.md §14.3).

### 13.3 Live preview

A `surface` card, radius 16, padding 14×12. Segmented tabs (4 equal, 44 px):
**Body · Choices · Strength · Word**. Below, the real components (`BodyMap`,
`OptionGrid`, `Slider`) in the selected theme at 50 % (195×422 px), radius 18,
soft shadow. Taps work; nothing is saved. It is `aria-hidden` and out of the tab
order: assistive technology and the keyboard use the real form, not these small
targets.

### 13.4 Theme list

`role="radiogroup"`, 2 columns, gap 10 px, 10 cards in preset order (ui.md
§14.9), each a `button role="radio"`:

- A 76 px mini mock in the theme's colours (and gradient): a 62 %-wide 7 px ink
  bar, a selected chip (30×14, `choice`), an unselected chip (24×14, `surface`
  with a `line` inset border), a 12 px `primary` bar. The selected card's mock
  shows the current base colour and gradient; the others preset colours.
- Name 15 px / 600 and a one-line description 12 px muted
  (`settings.appearance.theme.<id>.desc`).
- Selected: 2 px ink border, `--fx-lift-2`, a 22 px ink check badge top right.
- Selecting a theme resets the base colour to Original and the gradient to off.

### 13.5 Base colour

Tintable themes only. "Base colour" (16 px / 500), a `radiogroup` of 44 px round
swatches: **Original** (the preset's accent on its ground, tiny "orig"), then
Teal `#1F7A73`, Sky `#2563A8`, Indigo `#4F46E5`, Sage `#4E7A3F`, Lilac
`#6A4FA8`, Slate `#4A5A6E`, Rose `#A8456A`, Amber `#B7791F` (`SEEDS` in
`tint.ts`). Each shows the seed in its centre and the _derived background_ as
its ring. Selected: a white 1.5 px border and a 2.5 px indigo outer ring. Then a
"Custom" pill with a native colour input.

### 13.6 Gradient background

Same card, after a 1 px rule: a switch (52×32). On: the hint "Second colour —
the background fades into it", the same 8 swatches and Custom (default Sky), and
a 28 px horizontal preview bar (`role="img"`).

### 13.7 Moving background

Its own card: a switch with the hint "Slow, soft light on Home and sign-in.
Never during a check-in." (under reduced motion: "This device asks for less
motion, so the background stays still.").

- On by default; offered only where the painted theme has an ambient light
  (`fx.bg > 0`: not Ink, Mono, Paper) and the device does not ask for more
  contrast or forced colours. Off = a still picture, stored as `still: true`.
  Not part of the resolved theme, so not in `ui.theme`: it is never on screen
  during a check-in.
- **The light** (`common/Aura.svelte`, `lib/aura.ts`, `--aura-1…3` from
  `shared/theme/fx.ts`): three very soft fields of the theme's ground, gradient
  colour, surface and at most 12 % of the fixed highlight (never the accent),
  drawn once as 200 px radial gradients and scaled up; a lazy chunk loaded when
  idle, fading in over 900 ms. The lamp sits behind Now. They drift on 37, 53
  and 71 s, alternating: far below any breathing pace, a few px a second. Their
  strength is cut until ink, secondary text and the accent as text read at 4.5:1
  over every stack on every ground; the bottom of the screen (quiet lines, dots)
  stays plain.
- **Where**: moving behind Home and sign-in; still behind History and Settings,
  so a pane change shows no seam; not mounted in the check-in or on Saved.
- **Play**: a finger held on the empty page draws the nearest light ≤ 24 px
  toward it, critically damped, back on release (a mouse: a gentle follow ≤ 20
  px); pressing Now gathers the lamp under the finger. Nothing else: no ripples,
  trails, or anything that accumulates, rewards or reacts to a check-in.
- **Cost**: compositor keyframes; script only while a lean settles; asleep after
  20 s without input and while hidden; still under reduced motion and Save-Data;
  none with reduced transparency, more contrast or forced colours
  (performance.md §1).

### 13.8 Left-handed reach

Its own card: "Left-handed mobile reach", a switch, hint "Places the primary
buttons on the left edge." Stored as `leftHanded: true`. It sets
`html[data-handed="left"]`, which mirrors the check-in footer (Next left, Back
right), moves the check-in's exits row (Close, Stop here) to the left edge, and
mirrors Saved's actions. The pane dots are centred and do not move (ui.md §2.2).
Not part of the resolved theme. Reach rules: ui.md §4.5.

### 13.9 Status line

An `aria-live` region (13 px), mounted and empty unless contrast is low. A
Custom colour that fails ui.md §14.6 shows "Low contrast: <pairs> — pick another
colour" (600, ink) and is **not applied to the app**, only to the preview, until
another colour is picked. Pairs: text, buttons, selected, cards, secondary text,
and their "(gradient)" forms. Every built-in choice passes; only Custom can
fail.

### 13.10 Fixed-palette themes

Mono, Ink, Paper: no base-colour card; instead "<Name> keeps a fixed palette —
base colour, gradient and the moving background are not available for it."

### 13.11 Applying and storing

A choice applies at once, no Save button; stored in the encrypted prefs (ui.md
§14.8) and synced. A theme change never re-mounts the check-in form: only CSS
variables and variant props change, so a draft on screen keeps its state.

## 14. Themes

Code: `shared/theme/` (`schema.ts`, `presets.ts`, `tint.ts`, `fx.ts`,
`fonts.ts`, `validate.ts`), `client/src/lib/theme.ts`.

### 14.1 Principle and limits

A theme changes **presentation only**: colours (except the highlight), fonts,
radii, shadows, light effects, the chrome's style. It can **not** change copy,
order, dictionaries or validation; change the measurement controls or the
highlight; add icons, emoji or images or colour-code emotions; shrink targets
below 44 px, hide focus rings or disable reduced motion; load remote resources.

There are 10 presets. Seven (Calm, Lavender, Sea glass, Archive, Sand, Dusk,
Night) take a **base colour** (8 swatches or Custom) that regenerates the
palette and an optional **gradient** with a second colour; Mono, Ink and Paper
keep fixed palettes. There is no theme editor and no sharing: users pick a
preset, a base colour and a gradient, never tokens or variants. The schema stays
complete so editing or sharing could come without migration.

**Fixed fields.** `resolveTheme` (`tint.ts`) overwrites these whatever a preset
says, so the instrument is identical everywhere (ui.md §1.7, ui.md §1.11):

| Field                    | Value                                               |
| :----------------------- | :-------------------------------------------------- |
| `c.figureSel`, `c.bloom` | `#4F46E5` if ground luminance ≥ 0.2, else `#8EA2FF` |
| `v.intensity`            | `slider`                                            |
| `v.options`              | `grid`                                              |
| `v.l2`                   | `chips`                                             |
| `v.figure`               | `solid`                                             |
| `v.figureLabels`         | `false`                                             |
| `v.confidence`           | `buttons`                                           |

The check-in's help link and sheet (ui.md §6.5) look the same in every preset:
the hint's style, never the accent. Theme-dependent: every other colour, `f`,
`r`, `shadow`, `fx`, `v.progress`, `v.heading`, `v.stepLabel`, `v.tabs`,
`v.summary`. Bringing a variant back needs its own methodological decision and
the entry's `ui` record (data.md §3.6).

### 14.2 Schema `ThemeV1`

`shared/theme/schema.ts`:

```ts
type Hex = `#${string}`; // exactly #RRGGBB, uppercase when stored
interface ThemeV1 {
  schema: 1;
  name: string; // ≤ 32 chars
  tint?: "light" | "dark" | null; // recipe that can recolour it; null = fixed
  tp?:
    | { gs: number; choice: "ink" | "accent"; primary: "ink" | "accent" }
    | null;
  seed?: Hex | null; // base colour; null = original
  grad?: boolean;
  seed2?: Hex | null; // the gradient's second colour
  c: {
    ground: Hex;
    surface: Hex;
    ink: Hex;
    muted: Hex;
    line: Hex;
    track: Hex;
    accent: Hex;
    choice: Hex;
    onChoice: Hex;
    figure: Hex;
    figureLine: Hex;
    figureSel: Hex;
    bloom: Hex;
    primary: Hex;
    onPrimary: Hex;
    ground2?: Hex; // only with the gradient on
  };
  f: {
    ui: FontFamily;
    display: FontFamily;
    displayWeight: 400 | 500 | 600 | 700 | 800;
    mono: "JetBrains Mono";
    labels: "normal" | "mono";
  };
  r: { control: number /* 0–28 */; chip: 2 | 10 | 12 | 999 };
  shadow: boolean;
  fx: { // strengths 0–1
    glow: number; // halo: selected answer, focus, primary button, Now
    edge: number; // lit rim on surfaces and controls
    sheen: number; // top light / bottom shade on filled controls
    depth: 0 | 1 | 2; // flat (borders) / soft shadows (light) / luminous (dark)
    bg: number; // moving background; 0 = not offered
  };
  v: {
    progress: "segments" | "bar" | "dots" | "counter";
    heading: "plain" | "eyebrow" | "editorial";
    stepLabel: boolean;
    tabs: "segmented" | "underline";
    options: "grid" | "chips" | "grouped" | "list";
    l2: "chips" | "inline";
    intensity: "slider" | "bloom" | "ruler"; // intensity, arousal, head_mode
    figure: "solid" | "soft" | "hatch" | "glow";
    figureLabels: boolean;
    confidence: "buttons" | "segmented";
    summary: "plain" | "dot";
  };
}
```

Valence is always a bipolar slider. A preset (`PresetData`) adds `id` and
`desc`. **Normalisation** (`normalizeTheme`, `validate.ts`), never throwing:
unknown keys dropped; an invalid value takes `calm`'s; `r.control` clamped to
0–28; `fx` strengths clamped to 0–1 (missing → `calm`'s); colours must match
`/^#[0-9A-F]{6}$/i`, stored uppercase; `name` cut to 32. The base colour never
changes `fx`. `fx` is part of the resolved theme, so `ui.theme` (ui.md §14.7)
tells entries with different light settings apart.

### 14.3 Tokens and CSS variables

`themeCss` (`client/src/lib/theme.ts`) turns the resolved theme into variables
on `:root`; components read them and compute nothing.

- Colours: each `c.<name>` → `--c-<kebab-name>` (`--c-ground`, `--c-surface`,
  `--c-ink`, `--c-muted`, `--c-line`, `--c-track`, `--c-accent`, `--c-choice`,
  `--c-on-choice`, `--c-figure`, `--c-figure-line`, `--c-figure-sel`,
  `--c-bloom`, `--c-primary`, `--c-on-primary`).
- Shape and type: `--r-control`, `--r-chip`, `--font-ui`, `--font-display`,
  `--font-mono` (stacks with metric-matched local fallbacks, `fontStack` in
  `fonts.ts`), `--display-weight`.
- Derived:
  - **`--c-accent-text`**, the accent as text on the page (links, the editorial
    phrase): the accent where it reads at 4.5:1 on every ground (both, with a
    gradient), else moved toward `ink` in tenths until it does (`accentText`).
    `ink` always passes (ui.md §14.6), so it ends readable. **`--c-accent` is a
    fill and focus colour, never text on the ground.**
  - `--c-on-accent` (white where it reads at 4.5:1 on the accent, else whichever
    of ground and ink contrasts more), `--c-on-figure-sel` (the body map's count
    badge).
  - `--c-page`: `ground`, or `linear-gradient(165deg, ground, ground2)`; cards
    and controls keep solid colours.
  - `--r-card`: `control` when ≤ 6 (square stays square), else `control + 4`
    clamped to 12–24. `--r-field`: `control`, at most 14.

All screens use the same tokens. Variants are component props from the theme
store (`getTheme`, `onThemeChange`) and only affect check-in components.

**Light and depth** (`fxVars`, `shared/theme/fx.ts`; the full list of variables
is there). The `fx` numbers and the palette become ready-made colours, shadows
and gradients, so nothing needs `color-mix()` (Chrome 110 has none). Rules:

- A shadow that draws nothing is `0 0 #0000`, never `none`, so components can
  comma-join them.
- What marks an answer or focus glows only in the fixed highlight `S`:
  `--c-focus` = `S`, `--fx-sel-aura`, `--fx-focus-halo`, `--fx-thumb-aura`.
  Hover and press tints (`--c-surface-hi` +5 % `S`, `--c-surface-press` +10 %,
  `--c-hover-sel`, `--c-info` +10 %) are `S` too.
- The accent's light (Now's halo, the switch) is off where the accent is warm
  (`warm()`: Night's amber, the Amber base colour).
- Elevation by `depth`: light themes use soft ink shadows, dark themes black
  shadows and white hairlines, depth 0 none, plus `--fx-edge-line` (a 1 px line
  so white cards on white keep an edge).
- Sheens leave **30–70 % of a control's height clear**, where labels sit, so a
  label's contrast is the flat fill's.
- More contrast or forced colours (`prefers-contrast: more`,
  `forced-colors: active`, followed live) resolve every effect to nothing;
  `client/src/boot.css` does the same with `!important` for the first paint.

**Before first paint.** `applyTheme` caches the resolved values (never the theme
name) in `localStorage['emo-css']`, with a dark set too under "Match the
system". The external, precached `/boot.js` (`client/public/boot.js`, a plain
`<script src>` in `index.html` before the bundle) sets them with
`style.setProperty` and sets `<meta name="theme-color">` to `c.ground` (the
Android status bar). Without a cache the default theme paints; the chosen one is
known once the encrypted prefs are read after unlock. iOS ignores `theme-color`
in a home-screen app: `apple-mobile-web-app-status-bar-style` is
`black-translucent`, so the page runs under the status bar and its ground fills
it (top bars keep clear by `--safe-top`); the clock and icons are always white,
and iOS keeps the style the app was added with.

**Markup rules.**

- No inline script and no `style="…"` attributes: the CSP forbids them
  (reliability.md §4.1). Use classes, Svelte `style:` and CSSOM (`setProperty`).
  The prototype's inline styles are values, not markup.
- A global element reset has zero specificity:
  `:where(button) { color:
  inherit; font: inherit }` (`boot.css`); a plain
  `button` selector overrides component colours.
- Never put interpolated text in an SVG `<text>` through HTML wrappers; use
  plain text nodes.
- A long list scrolls inside its flex child, which needs `min-height: 0`.

### 14.4 Component specs

v1 builds only the fixed variants (ui.md §14.1). The other specs stay, marked
**reserved**, so they can return without re-deriving them.

**Header**: padding 22 px 24 px 0, min-height 64, gap 16. Progress: `segments`
10 flex segments 4 px high, radius 2, gap 4, done accent, rest track; `bar` a 6
px track with an accent fill of step/10; `dots` 10 dots 6×6, the current an 18×6
pill, done accent, rest line; `counter` mono 11 px .14em uppercase "02 / 09 —
QUALITY" over a 2 px `line` rule with an ink fill of step/9. Skip link 14 px
muted, dotted (offset 3); `bar` shows just "Skip" without underline; mono-label
themes mono 11 px uppercase.

**Text links** (text buttons and `<a>`): underlined in the text's colour, offset
3 px. **Solid** when the view is replaced: another screen, step or site (Back,
Cancel, Change, "Sign in to sync", "Use a different account", "after an event",
the check-in's Close, external links). **Dotted** 1.5 px when it acts where it
stands, a sheet or confirm included: copy, share, resend, Show/Hide, "Suggest a
passphrase", "Not now", "Skip it", Turn on / Keep off / Resume, Restart, "About
and privacy", help links, Skip check-in / Stop here, Revoke, Sign out, the
Deletes (no red; the confirm warns). Class `text-action` (`boot.css`); no hover
change. **Dashed is never a link**: it means untouched (sliders) or a warning
(the note validator, ui.md §8).

**Heading block** (gap 6): optional step label "Step N of 9" (13 px muted; mono
caps in mono-label themes); optional eyebrow (12 px / 600 / .14em uppercase
muted); title in the display font, theme weight, 30 px, line-height 1.1,
−0.015em. `editorial`: 40 px, −0.02em, the key phrase italic in
`--c-accent-text`, split per step in i18n as `{pre, em, post}` (e.g. "Where | in
the body | ?"), defined for all 9 steps; the note's
`checkin.step.10.title.editorial.*` stay unused. Hint 15 px muted (mono-label
themes: mono caps, 12 px padding-bottom, a 1 px ink rule).

**Main**: padding 26 px 24 px 12 px (20 px top for `counter`), gap 20 (14 on the
body step).

**Options**: `grid`: 2 columns, gap 8; min-height 48, padding 10×14, radius
`control × 0.75`, 1.5 px `line` border, `surface`, 16 px, left-aligned; selected
`choice` background and border, `onChoice` text; states from `.answer` (below).
Reserved: `chips` (flex-wrap, gap 8, min-height 44, padding 0 16, radius `chip`,
15 px / 500, selected 700; `shadow` themes add
`0 6px 18px -10px rgba(40,30,90,.35)`); `grouped` (chips under 12 px / 600 /
.1em uppercase muted group headers, 18 px apart; the groups belong to the
dictionary, `QUALITY_GROUPS`); `list` (2 columns, column-gap 24, top border;
rows min-height 44, `line` bottom border, transparent, 16 px, a 13 px radio dot,
1.5 px ink border, selected filled accent with accent 600 text).

**Front/Back tabs**: `segmented`: a track container, padding 4, radius
`control`, tabs 44 px, the active one a sliding `surface` puck, 600, shadow
`0 1px 3px rgba(0,0,0,.14)`. `underline`: mono 12 px uppercase .14em, 24 px gap,
active a 2 px ink bottom border on a 1 px `line` rule, tabs 44 px wide.

**Body highlight**: `solid` (`figureSel` fill). Reserved: `soft` (no outline, 7
px seams in `ground`, base figure tinted), `hatch` (45° stripes, 7 px period,
2.4 px stripes of `figureSel` over `figure`), `glow` (solid plus a blurred copy
behind, Gaussian σ 18, opacity .9, and a faint radial accent wash at the top),
`figureLabels` (1 px ink leader lines with a 2 px dot to mono 12 px labels on
the right; the figure shifts left).

**Selection summary**: 15 px muted, centred, the bold part 600 ink (glow themes:
`figureSel`); `dot` prefixes a 7 px `figureSel` dot; mono-label themes
left-aligned mono caps "SELECTED — THROAT, CHEST".

**Intensity** (every variant wraps a real `<input type="range" min=0 max=10>`
over the visual track at opacity 0). `slider` (`common/Slider.svelte`, press
logic `client/src/lib/press.ts`):

- A 6 px track (track colour, `--fx-inset`), **no fill** (a fill reads as "more"
  on the bipolar valence and adds a magnitude cue); valence has a `muted` centre
  tick.
- The thumb is 32 px in every engine and is `bloom`, the fixed highlight, in
  every theme. Touched: `bloom` with `--fx-thumb-sheen`, a 3 px `surface`
  border, `0 1px 3px rgb(0 0 0 / .25)` and `--fx-thumb-aura`. Untouched: a 2 px
  dashed `bloom` ring on `surface`, unlit, never animated.
- What answers it (ui.md §6.2): a still tap on the thumb, or Space / Enter,
  lights it where it is; a still tap elsewhere on the track sets the value under
  the finger (iOS does not move the thumb on a track tap, Android does). Still =
  let go within 10 px of where it went down, not taken by the browser
  (`pointercancel`); within about 22 px of the thumb's centre it is a tap on the
  thumb. `touch-action: pan-y pinch-zoom`, so a vertical drag scrolls and
  answers nothing. During a touch or pen press that has not slid yet (10 px,
  more along the track than across), a value the browser set by itself (Android
  jumps to the finger on touchstart) is held back: a slide or a still tap keeps
  it, a scroll puts it back. A mouse is never held back; a click on the thumb
  answers on release.
- Reserved `bloom`: a 290 px area above the slider with a halo circle (track), a
  dashed ring inset 40 px (accent at 53 %), a core of diameter `56 + value × 16`
  px with a radial gradient (35 %/30 % highlight → `bloom`) and a soft shadow
  (glow themes `0 0 60px 10px` bloom at 40 %); untouched: no core, "Not set" (18
  px bold) / "slide to set" (13 px). Reserved `ruler`: 41 ticks (every 10th 22
  px, every 5th 16 px, others 10 px, 1 px ink), a 2×50 px `bloom` needle with a
  10 px dot; untouched: the needle centred at 35 % and "NOT SET" under a 70×3 px
  ink dash; poles in mono caps.

**Word step**: level 1 the grid; level 2 `chips` (40 px, radius `chip`, 14 px,
selected border and text accent); certainty `buttons` (3 equal grid buttons;
mono-label themes mono caps 11 px, radius 2). Reserved: `inline` level 2
(display font 22 px, selected accent with a 1.5 px underline at offset 5);
`segmented` certainty (a track container, the active segment `surface` with a
shadow).

**Footer**: Back 56×56, radius `control`, the secondary button, a 20 px chevron.
Next fills the rest, 56 px, radius `control`, the primary button, 16 px / 600
with an 18 px arrow; `shadow` themes add `0 12px 24px -12px primary`. Disabled
Next is `track` with a `muted` label, never a fixed grey.

**Light**: every value a token of ui.md §14.3, so at `fx` 0 the plain controls
draw and selection still reads from fill and weight.

- **Answer controls** (`.answer`, `client/src/components/flow/answer.css`: grid,
  null pairs, certainty, finer words, situations): rest `--fx-rim, --fx-lift-1`;
  hover (fine pointer) border `--c-line-strong`, bg `--c-surface-hi`; press
  `scale .98`, `--c-surface-press`, `--fx-press`; selected `choice` with
  `--fx-sheen`, 600, `--fx-rim-fill, --fx-sel-aura` (a halo, never a crisp ring:
  that means focus); focus 3 px `--c-focus` and `--fx-focus-halo`. Null pairs
  differ in shape only (`.answer--pill`: radius 22, 44 px), so a null answer
  never looks different; `e2e/fx.e2e.ts` compares them in every state.
- **Primary** (`.btn-primary`, `client/src/fx.css`: Next, Send code, Sign in,
  Done, Save, Undo): `primary` + `--fx-sheen`,
  `--fx-rim-fill,
  --fx-primary-aura`; hover `--c-primary-hi`, `-aura-hi`;
  press `scale .985`, `-aura-press`; disabled `track`, `muted` label, inset 1.5
  px `line`; busy keeps the lit look with the busy light (ui.md §5.1).
- **Secondary** (`.btn-secondary`: Back, Cancel, Later, Undo on Saved): 1.5 px
  `line`, `surface`, `--fx-rim, --fx-lift-1`; press `scale .985` (Back, Close,
  icon buttons .94).
- **Fields** (`.fx-field`: sign-in, passphrase, code, times, "other", note): a
  well one step below its container (`--c-field`: ground on cards and sheets,
  surface in the check-in), radius `--r-field`, `--fx-inset`; focus border
  `--c-line-strong`, bg `surface`, one 3 px `--c-focus` ring and
  `--fx-focus-halo`; error 2 px ink; the note's warning 2 px dashed ink, no
  halo.
- **Segmented control** (`.seg`: Front/Back, language, the Appearance preview,
  desktop pane tabs): track, `--fx-inset`, radius `control`; the chosen option a
  sliding `surface` puck with `--fx-rim`, a 1 px shadow, `--fx-lift-1`.
- **Cards**: sign-in `surface`, 1 px `line`, `--r-card`,
  `--fx-rim, --fx-lift-2`; Settings, History and theme cards
  `--fx-rim, --fx-lift-1, --fx-edge-line` (chosen theme 2 px ink,
  `--fx-lift-2`); the update card and the toast likewise; sheets
  `--fx-rim, --fx-lift-up` over `--c-scrim`; the pane-dots pill
  `--fx-rim, --fx-lift-1`. History is a reading surface: no halos.
- **Switch**: track 52×32 in a 44 px target; off `track` with an inset 1.5 px
  `--c-line-strong` edge (≥ 3:1 on the card); on accent with `--fx-sheen`,
  `--fx-rim-fill, --fx-accent-aura-sm`; knob `--c-knob`.
- **Now** (ui.md §3): the mark in the accent, its layers the accent at 26 %; the
  core a lit bead with `--fx-orb-sheen` (upper-left highlight) and
  `--fx-orb-rim` (inner shade at the bottom), clear of the label;
  `--fx-now-aura` (`-hi` hover, `-press` press) and `scale .95` on press; the
  rim light `--fx-ring` round the outer disc. It never moves on its own, never
  breathes or pulses. Forced colours: the outlines of Now and its core.
- **Recovery-key choices**: at rest like an answer; done = 2 px `--c-focus`
  edge, `--c-surface-hi`, `--fx-sel-aura`, the mark a highlight dot. The
  information box: `--c-info` with a 3 px `--c-focus` rule.

### 14.5 Fonts

Self-hosted woff2 in `client/public/fonts/`. Only the active theme's fonts are
precached; others are fetched and cached when chosen. Manifest (`FONT_MANIFEST`,
`shared/theme/fonts.ts`) and byte budget: performance.md §2.

Allowed, all with Cyrillic: Onest (default), Golos Text, IBM Plex Sans, Manrope,
Rubik, Unbounded (headings), Literata (serif headings, italic), JetBrains Mono.
Four presets name Latin-only families in their data (Hanken Grotesk, Plus
Jakarta Sans, Sora, Newsreader); the resolver paints replacements
(`FONT_MIGRATION`): `mono` Golos Text; `lavender` Manrope; `night` Onest +
Unbounded (display); `paper` Golos Text + Literata (display). Never paint a font
without Cyrillic: ru and uk are first-class. The schema still accepts the four
names so older data normalises without loss.

### 14.6 Base colour, gradient and checks

`shared/theme/tint.ts`: `light(seed, tp)`, `dark(seed)`,
`applyTint(preset, seed, grad, seed2)`, `checks(c)` →
`{ readable, bad[], warm, dark }`. A port of the prototype's `TINT`; the code is
the reference.

- **Light recipe** (Calm, Lavender, Sea glass, Archive, Sand): hue and
  saturation from the seed (saturation clamped 25–75 %); `ground` L 92 %,
  `surface` L 98 %, `ink` L 13 %, `muted` L ≤ 36 % (lowered until 4.6:1 on
  ground), `line` L 77 %, `track` L 85 %, `accent` L ≤ 42 % (lowered until white
  text reaches 4.6:1), `figure` = surface, `figureLine` L 57 %, `onChoice` and
  `onPrimary` white. `tp`: background saturation factor `gs` (default 0.5) and
  whether `choice` and `primary` are `ink` or `accent`.
- **Dark recipe** (Dusk, Night): saturation 25–80 %; `ground` L 9 %, `surface` L
  14 %, `ink` L 94 %, `muted` L 68 %, `line` L 25 %, `track` L 19 %, `accent` L
  ≥ 66 % (raised until 4.6:1 on surface), `choice` = accent, `onChoice` L 9 %,
  `figure` L 12 %, `figureLine` L 30 %, `primary` L 94 %, `onPrimary` = ground.
- **Highlight**: never from the seed: `#4F46E5` on a ground of luminance ≥ 0.2,
  else `#8EA2FF`, applied to original colours too.
- **Gradient**: `c.ground2` = the second colour's light-recipe ground; for dark
  themes its `track` (L 19 %), so the fade shows. Fixed palettes take neither.
- **Checks**: ≥ 4.5:1 for text (`ink`/`ground`), buttons, selected, cards
  (`ink`/`surface`), secondary text (`muted`/`ground`), and with a gradient
  `ink` and `muted` on `ground2`; the highlight on `figure` ≥ 3:1 (WCAG 1.4.11).
  `warm` (hue < 55° or > 340° with saturation > 35 %) is computed and a unit
  test asserts it false for every resolved theme. Dark = ground luminance < 0.2.
- **All built-in choices pass**: 7 tintable presets × 9 base colours (with
  Original) × 9 gradient states, plus 3 fixed: 570 themes, none with a warm
  highlight, highlight ≥ 4.88:1 on the figure (`shared/theme/theme_test.ts`).
  Only Custom can fail (ui.md §13.9). Home and the open check-in are also
  audited in every preset and with a gradient (`e2e/theme.e2e.ts`).

### 14.7 Stored appearance preference

```ts
interface AppearancePref {
  themeId:
    | "calm"
    | "mono"
    | "lavender"
    | "paper"
    | "night"
    | "ink"
    | "seaglass"
    | "archive"
    | "dusk"
    | "sand";
  seed: Hex | null; // null = original; ignored for fixed palettes
  gradient: boolean; // ignored for fixed palettes
  seed2: Hex | null; // used when gradient is on
  auto?: true; // Match the system (ui.md §13.2)
  still?: true; // Moving background off (§13.7)
  leftHanded?: true; // Left-handed reach (§13.8)
}
```

Flags are stored only when on, so older prefs and clients read the same;
`normalizeAppearance` also reads the older `{ preset }` shape. The app paints
`resolveTheme(effectiveAppearance(pref))` (with `auto`: Calm or Dusk in original
colours). An entry's `ui.theme` is the first 16 hex characters of SHA-256 over
the canonical JSON of the resolved theme (`currentEntryUi`,
`client/src/lib/theme.ts`; data.md §3.6).

### 14.8 Storage

- In the encrypted `prefs` (DEK, like entries) as
  `{ appearance: AppearancePref }`, synced with `PUT/GET /api/prefs` as one
  blob, last write wins (api.md §2.7). A preference from another device replaces
  the current one, never merges. Other tabs get it as a `prefs` broadcast and
  apply it without reload (reliability.md §1.3).
- The server never learns the theme. The only plaintext copy is the value cache
  for `/boot.js`. Plaintext copies of older builds
  (`localStorage['emo-theme-preset']`, `meta.appearance`) are deleted at start.

### 14.9 Presets

`shared/theme/presets.ts` (`PRESETS`) holds every preset value: colours, fonts,
radii, variants, `tp`, `fx`. Card subtitles:
`settings.appearance.theme.<id>.desc`. `calm` is the default; list order is
`PRESET_IDS` (`schema.ts`):

| id         | Name      | Subtitle (en)                      | Ground | Base colour, gradient |
| :--------- | :-------- | :--------------------------------- | :----- | :-------------------- |
| `calm`     | Calm      | Default · pale blue, slate, indigo | light  | yes (light recipe)    |
| `mono`     | Mono      | Neutral greys · bold type          | light  | fixed                 |
| `lavender` | Lavender  | Soft pills · lavender              | light  | yes (light recipe)    |
| `paper`    | Paper     | Editorial serif · paper            | light  | fixed                 |
| `night`    | Night     | Dark · amber accents               | dark   | yes (dark recipe)     |
| `ink`      | Ink       | Stark black and white              | light  | fixed                 |
| `seaglass` | Sea glass | Mint and teal · rounded            | light  | yes (light recipe)    |
| `archive`  | Archive   | Serif · dusty blue                 | light  | yes (light recipe)    |
| `dusk`     | Dusk      | Dark and cool · periwinkle         | dark   | yes (dark recipe)     |
| `sand`     | Sand      | Muted sand · olive                 | light  | yes (light recipe)    |

`fx`: Dusk is the reference luminous theme, Lavender the most luminous light
one, Archive and Sand restrained; Night is dark but its amber accent gives no
light (ui.md §14.3); Ink, Mono and Paper opt out with zeros in their data, not
by a special case in the resolver. Every preset passes ui.md §14.6 in its
original colours. `design/09-theme-presets.png` shows unbuilt variants and warm
highlights (bloom, ruler, grouped, list, hatch, soft, glow, labels, a peach
Lavender, an amber Night highlight): use it for colours, type and chrome only.

## 15. History pane

A read-only, chronological list of the person's own check-ins on this device,
where any entry can be deleted. Code: `client/src/components/history/*`
(`History.svelte`, `HistoryEntry.svelte`, `HistoryRecord.svelte`,
`TrackView.svelte`, `BodyGlyph.svelte`), `client/src/lib/history.ts` (load,
pages, reconcile, row formatters), `client/src/lib/historyRecord.ts` (record
formatters). Copy: ui.md §15.18.

### 15.1 Purpose and stance

It is for: material for therapy sessions (what, where, when; methodology.md §6);
seeing that a check-in was saved and whether it reached the server (ui.md
§1.10); deleting a mistaken entry; seeing what is stored without exporting.

It must never become:

- **a mood chart**: rows carry no valence, arousal or word; no colour per state,
  no icons; slider values only inside one open record, as positions, never
  numbers;
- **a scorecard**: no counts anywhere, no missed reminders, no empty-day
  markers, no calendar; manual check-ins are not highlighted;
- **a prompt to interpret or an analysis surface**: no summaries, insights,
  search, filters, annotations, aggregates or trends (analysis belongs to a
  future Reports pane, methodology.md §5.4);
- **a place to rewrite the past**: entries are immutable (ui.md §15.11);
- **a template for the next answer** (ui.md §15.2);
- **a flood**: one record opens at a time, on a tap; pages end in a button.

### 15.2 Shielding the next check-in

Seen answers become anchors for the next one: copying, "what I usually say",
frozen granularity, consistency (methodology.md §1.1, methodology.md §2.2). So:

1. **Reminders never pass the list.** A notification opens `/now?reminder=…`
   directly (ui.md §6.1). With Emo open on History or Settings, the service
   worker posts the URL before focusing, and the app goes straight to the
   check-in, unmounting History and its rows (reliability.md §1.6).
2. **Nothing from the past is on any path into the check-in**: not on Home (no
   last check-in, no count), not in the flow, not on Saved.
3. **Home ↔ Settings never mounts History**: dots, tabs, the wordmark's long
   press and Esc jump straight to their target; only a swipe or ←/→ steps
   through it.
4. **Hidden while a check-in is in progress** (ui.md §15.14): otherwise one
   could close a check-in (Close keeps the draft), read old answers and resume.
5. Word and slider positions are seen one record at a time, after a tap; there
   is nothing aggregate to stay consistent with.

Opening History deliberately before a manual check-in is allowed and is not
recorded.

### 15.3 Placement and navigation

The pane `history` in `client/src/lib/panes.ts`: order 1 of Check-in (0) ·
History (1) · Settings (2), route `/history`, label `home.pane.history`. A
Reports pane would go after History; Settings is always last. Always enabled,
even when empty (unlocking it after a first check-in would be a reward). The
chunk loads on first open, never prefetched; nothing is decrypted until then.
Pane mechanics: ui.md §2.2.

- Home → History: the second dot, the desktop tab, swipe left or →.
- Home → Settings: the third dot, the tab, the wordmark's long press: directly.
- History: swipe right or ← → Home; swipe left or → → Settings; Esc, system Back
  or the Check-in dot → Home; the wordmark → Home.
- Settings: swipe right or ← → History.
- Cold start on `/history`: History after unlock. Lock or sign-out: the pane
  unmounts and drops its data.

Keys and swipes are ignored in fields and dialogs (ui.md §5.3). The pane is
pushed over `/` like Settings, so system Back returns Home. On open, focus goes
to the `<h1>` (`tabindex="-1"`, no ring) (ui.md §5.5).

### 15.4 Layout

**Phone** (390×844 baseline, down to 320):

- The shared pane bar and the fixed bottom dots (ui.md §2.2); the Settings
  chrome: "History" 26 px / 500, the hint `history.hint` ("Each check-in is kept
  as it was in that moment.") 15 px muted; no back chevron. Sticky heads as in
  ui.md §11.2.
- The reach room sits above, out of view at rest (ui.md §4.5). Side padding
  16–20 px; ≥ 62 px plus the bottom safe area free under the list. The body
  scrolls.
- Days are sections; a day header is the Settings section header and holds under
  the title. An open record's row holds under the day header, on the card's
  `surface` with a 1 px `line` under it once held; a tap on it there closes the
  record, the row staying put while the record folds away under it.
- Each day's check-ins sit in one `settings-card` (radius 16, 1 px `line`
  between rows). Styles reuse `settings.css` and theme tokens; no new colours.

**Desktop** (≥ 900 px, ui.md §9): the pane bar with Check-in · History ·
Settings tabs, day headers sticking under it; column 680 px, centred, title 34
px; the same list with inline expansion, no master-detail; an open record is a
grid of 140 px labels and flexible values; tracks at most 280 px wide; a footer
legend (13 px muted, `aria-hidden`, `history.keyboardLegend`).

### 15.5 Order and grouping

- Newest first by `ts`; ties by `id`, for a stable order.
- Days by the entry's own local date (`ts` shifted by `tz_offset_min`): a 14:10
  check-in made in Kyiv stays 14:10 viewed from Lisbon.
- Day header: "Today" / "Yesterday" by the device's date, else
  `Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month:
  "short" })`,
  with the year when not the current one. **No counts.**
- Days without entries do not appear; no gap markers: skips are never imputed,
  and gaps on screen are a compliance meter (methodology.md §5.3, ui.md §1.5).
- Time: `Intl` hour and minute, `tabular-nums`. When the entry's offset differs
  from the device's offset at that instant
  (`-new Date(ts).getTimezoneOffset()`), a quiet "UTC+3" follows: travel only,
  never daylight saving alone.

### 15.6 Collapsed row

An index of moments: when, where, what happened.

1. **Time · situation** (the context label or the `context_other` text), 16 px,
   time 600. At the right, 13 px muted: "after an event" when
   `trigger = after_event`; a 10 px hollow ring while in the outbox; the chevron
   (turns 180° open).
2. **Body** (not skipped): locations then qualities, "chest, throat — tight,
   lump"; locations in canonical order (ui.md §7.5), qualities in dictionary
   order; `whole_body` → "whole body"; `nowhere` and legacy `[]` → "nowhere". 15
   px ink, at most 2 lines. A skipped entry shows **"Skipped"**
   (`skipped && !abandoned`) or **"Form left open"** (`abandoned`) instead,
   whatever it kept, in the same size, colour and weight.
3. **Note**, only if there is one: its first line in curly quotes, 15 px ink,
   one line, ellipsis.

**Never on a row: valence, arousal, the word.** They are the most evaluative
variables; a column of them is a mood timeline and the easiest thing to copy.
`after_event` is on the row because it is the person's own "this is about an
event" marker; `random` and `manual` appear only in the record, all three styled
alike (highlighting manual ones would reward them, methodology.md §2.14).

### 15.7 Open record

Lines 2–3 hide and the record appears under line 1, which stays as its header.
Fields follow the recorded step order (data.md §4): BODY, QUALITY, INTENSITY,
TONE, CHARGE, WORD, URGE, ATTENTION, SITUATION, NOTE. Labels are the
instrument's eyebrows (`checkin.eyebrow.1…10`) as `<dt>`, 12 px / 600 / .1em
uppercase muted.

- **BODY**: the zones as text and a read-only mini figure, front and back 44×88
  each (`BodyGlyph.svelte`, geometry shared with the body map in
  `client/src/lib/bodyFigure.ts`): under the text, left-aligned; beside it,
  right-aligned, when the record is ≥ 32rem wide (a container query, so narrow
  windows and large text stack). Solid fixed highlight, `aria-hidden`.
  `whole_body` tints the whole silhouette (ui.md §7.4); `nowhere` no fill.
- **QUALITY**: "tight, lump" / "nothing" / "can't tell".
- **INTENSITY**, **CHARGE**, **ATTENTION**: read-only tracks
  (`TrackView.svelte`, the instrument's look at reduced scale: 4 px `track`, 14
  px thumb in the fixed highlight) with the poles under them. **No number.**
- **TONE**: a read-only bipolar track with the centre tick, poles "unpleasant ·
  neutral · pleasant"; neutral track, **no red or green**.
- **WORD**: `l1` → its label; `l1.l2` → "fear · anxiety" (l1 muted, l2 ink),
  certainty after a dash ("— guessing"); `unknown` → "don't know" (no
  certainty); `empty` → "empty"; `null` → "not chosen".
- **URGE**: its label, "nothing", or "not chosen".
- **SITUATION**: its label; `other` → "other: balcony".
- **NOTE**: verbatim (`pre-wrap`), escaped, never linkified; omitted when empty.

Then the metadata line, 13 px muted: "From a reminder" / "Without a reminder" /
"After an event" · "UTC+3" when relevant · "Not synced yet" in the outbox. Then
**Delete this check-in** (ui.md §15.10).

**Skipped and abandoned records** keep their label as the first line, then the
answers given before `stopped_at` (data.md §3.6) in the same order and form,
then metadata and Delete. Steps not reached are left out (never asked, so not
"not chosen"). A skip on step 1, or one older than `stopped_at`, shows the
label, metadata and Delete only. No "incomplete" message: a skip is a whole
record.

**Never shown**: `latency_sec`, `hidden_sec`, `ui`, `reminder_id`, `schema_v`,
the `untouched` array (only as "not moved" on its slider), any number.

### 15.8 Null, "don't know" and skipped answers

All render in the **same size, colour and weight** as any value: never greyed,
italic, dashed or marked missing (ui.md §1.4); the formatters are unit-tested
for each case.

| Data                                        | Shown as                                                                |
| :------------------------------------------ | :---------------------------------------------------------------------- |
| `locations: ["nowhere"]`, legacy `[]`       | "nowhere"                                                               |
| `locations: ["whole_body"]`                 | "whole body"                                                            |
| `qualities: ["nothing"]` / `["cant_tell"]`  | "nothing" / "can't tell"                                                |
| `word: "unknown"` / `"empty"` / `"empty.*"` | "don't know" / "empty" / "empty · numbness"                             |
| `word: null`, `urge: null`                  | "not chosen" (the step was optional)                                    |
| `urge: "nothing"`                           | "nothing"                                                               |
| slider in `untouched`                       | the untouched thumb (dashed ring) at the midpoint, "not moved" at right |
| `skipped` / `abandoned`                     | "Skipped" / "Form left open"                                            |
| retired dictionary key                      | its label (data.md §8.2)                                                |

Skipped and abandoned check-ins are shown: they are entries, never failures, and
useful material ("what was going on at 16:30 when I left it open?"). Missed
reminders are not: a ledger of misses turns practice into duty; misses are a
pattern for analysis, never gaps on screen (methodology.md §5.3). One neutral
highlight, the same in every theme, appears only on thumbs and the mini figure.
The unsynced ring reuses the sync dot's "pending". Red appears only on the
irreversible delete's confirm button (`ConfirmSheet destructive`), an action
colour never attached to content.

### 15.9 Expand and collapse

- Each row header is `<h3><button aria-expanded aria-controls="entry-…">`; the
  record is a sibling `<div id="entry-…">` (WAI-ARIA disclosure). The name is
  line 1 ("14:10, work, after an event, not synced yet"); lines 2–3 are its
  `aria-describedby` while collapsed; the name never changes on toggle.
- **One record open at a time**, desktop too: opening one closes the other; a
  tap on the open one closes it. Two moments are never side by side.
- The tapped row keeps its place while the other record folds: scroll anchoring
  does it; without it (Safari) History holds the row through the fold, never
  scrolling the reach room into view, and holds nothing at the resting top.
  Everything collapses when the pane is left.
- Opening folds in 280 ms (grid rows), the content fading in after; closing
  fades and folds in 200 ms, then leaves the page (ui.md §5.1). Reduced motion:
  nothing animates.
- The record's code is its own chunk, fetched once the first rows are on screen,
  so opening never waits.
- No swipe actions on rows: sideways swipes belong to the panes, and
  swipe-to-delete makes deleting too easy.

### 15.10 Delete

1. In an open record, **Delete this check-in**: a 44 px dotted text button in
   ink, at the record's right edge on a phone.
2. A `destructive` `ConfirmSheet`: "Delete this check-in?" —
   `history.delete.body` (the date and time; removed from this device, the
   server and the other devices when they sync; can't be undone) — Cancel /
   Delete.
3. On confirm the **row goes at once**; nothing waits for the network.
   `deleteFromHistory` → `tombstoneEntry` (`client/src/lib/sync.ts`) writes the
   tombstone and replaces any pending upload with `op: "delete"` in **one
   IndexedDB transaction** (`writeTombstone`), without the `emo-sync` lock (a
   pass may hold it while a request hangs; it leaves an op queued meanwhile
   alone, and the `DELETE` goes on the next pass, architecture.md §8.3). Then a
   `{type: "entries"}` broadcast and a background sync. Offline or signed out it
   queues. A storage error leaves the entry saved, never half deleted.
4. Focus moves to the next row, else the previous, else the `<h1>`; the polite
   live region says "Check-in deleted".
5. **It never reopens the form and never writes a draft**: Undo may refill the
   form because it comes seconds after the moment; doing so from History would
   be a retrospective entry with a false `ts`.
6. A `403 auth_proof_invalid` is handled by sync (reliability.md §1.3): the
   tombstone stands and the request is retried.
7. If it was the Home toast's last saved entry, the toast forgets it
   (`lastSaved.ts` `forget`).

Any record can be deleted, skipped ones too; nothing invites it: two taps and a
confirmation, no bulk or day delete, no swipe, no undo toast. Route:
`DELETE /api/entries/:id` (api.md §2.6).

### 15.11 No editing

A record is a timestamped reading of the body; changing it later writes a
retrospective report over an ecological one (methodology.md §1.1, data.md §2).
So: no edits, no typo fixes in the note, no backfilled check-ins, no comments
added later. The hint under the title says so once.

### 15.12 Loading and paging

- Volume: 3 a day is about 1 100 a year; 3 000 is the test volume.
- **Load** (`loadHistory`): read ciphertext rows and outbox ids; skip tombstones
  and rows flagged `undecryptable` / `invalid` / `newer`; decrypt the rest in
  the Worker of `client/src/lib/decrypt.ts` in batches of 200 (`DECRYPT_BATCH`),
  newest `seq` first, then sort by `ts`. Without a Worker the same batches run
  on the main thread (performance.md §3.1).
- Everything is decrypted because `seq` is upload order, not save order, and no
  plaintext `ts` exists on disk, by design.
- **Pages** (`PAGE = 30`, `pageEnd`): the newest 30, rounded up to the end of
  the last day. A full-width secondary **Show earlier** appends the next page
  and focuses its first new row. The DOM holds only the rendered pages. **No
  infinite scroll**: it removes the stopping point, hurts keyboard and
  screen-reader use, and builds a scrolling habit.
- **End line**: "No earlier check-ins on this device."; after eviction of old
  ciphertext (`meta.evicted`, set by `evictSyncedEntries`, reliability.md §1.1)
  also "Older ones are kept on the server." Nothing is pulled back.
- Budgets (first rows ≤ 1 s at 1 100 entries, ≤ 2 s at 3 000; a record within
  one frame; chunk sizes): performance.md §1.

### 15.13 Live updates

- **Reconcile** (`reconcileHistory`) after each sync pass, on
  `visibilitychange → visible`, and on `{type: "entries"}` from
  `BroadcastChannel('emo')`: read rows past the highest `seq` seen (`idx_seq`)
  and the outbox, decrypt only those, insert or remove in place.
- The open record stays open and the scroll position holds: rows added above
  must not push it down (`overflow-anchor`; on Safari manual compensation; at
  the reach room's edge the place is put back). No "new entries" banner.
- A record deleted elsewhere disappears; if it was open, the live region says
  "Check-in deleted".

### 15.14 States

- **Loading**: after 300 ms (no flash), one muted line "Opening check-ins…";
  `aria-busy="true"`; no spinner, no count.
- **Empty**: "No check-ins yet" (17 px / 500) and "Each check-in you save will
  appear here." (15 px muted), centred. **No call to action.**
- **A check-in in progress** (a draft, any tab): `finalizeIfAbandoned` runs
  first (ui.md §6.2); if a draft remains: "A check-in is in progress." / "Past
  check-ins show again once it is saved or skipped." with **Continue it** and a
  secondary **Skip it**; nothing is decrypted. Skip it ends the draft as stopped
  on its screen, keeping the answers before it (ui.md §6.2), through App's
  `handleSkipDraft` as on Home; both buttons stay disabled until the list is
  back, so a double tap saves one; its Undo shows on Home for what is left of
  its 10 s (ui.md §6.5).
- **The draft in another tab**: `checkin.otherWindow` with **Go to it**
  (reliability.md §1.3).
- **Offline**: fully usable; the offline band shows (ui.md §3.6); deletes queue.
  **Signed out (401)**: the same; deletes queue until sign-in (reliability.md
  §1.4).
- **In the outbox**: the hollow ring and "Not synced yet"; not hidden, not
  alarming.
- **Undecryptable, invalid, needs a newer app**: not in the timeline (their `ts`
  is unknown); one quiet note under the hint, reusing
  `settings.data.unreadable.*`. Every sync pass rechecks them (data.md §8.1), so
  they join once a build that reads them runs.
- **First full pull**: what is local, with the end line "Syncing…"
  (`history.syncing`) until the pass ends, then a reconcile.
- **Locked**: unreachable; locking unmounts the pane and drops the plaintext.

### 15.15 Keyboard

Tab / Shift+Tab: each row button, then (in the open record) Delete, …, Show
earlier. Enter / Space on a row: toggle. ← / →: Home / Settings, ignored in
fields and dialogs. Escape: Home; in the confirm sheet, cancel. No arrow-key
roving between rows: the arrows belong to the panes (ui.md §5.4).

### 15.16 Screen readers

- `<main aria-labelledby>`: h1 "History", h2 per day, h3 per row, so readers
  jump to days or moments by heading level; each record is a `<dl>`.
- Tracks are `role="img"` with `aria-label="{label}: {value}"`
  (`a11y.history.track`) in the instrument's word scale
  (`a11y.slider.low/mid/
  high`, `a11y.valence.neutral`,
  `a11y.slider.untouched`), e.g. "INTENSITY: closer to “very strong”". **Never a
  number, never `<meter>` or `<progress>`** (they announce percentages).
- The mini figure is `aria-hidden`; the unsynced ring is `role="img"` with a
  label; one persistent polite live region announces "Check-in deleted" (the
  same words twice still announce).
- The checklist (ui.md §10) applies: native buttons, targets ≥ 44 px (the row
  button ≥ 52 px, ≥ 64 px with its summary), 4.5:1 text in every preset, visible
  focus, colour never the only signal.

### 15.17 Privacy and memory

Plaintext lives only in component memory: never in IndexedDB, `localStorage`,
`history.state`, the URL, `title` attributes or the diagnostics buffer
(reliability.md §1.8, architecture.md §8.1). It is dropped on leaving the pane,
lock (`{type: "lock"}`), sign-out and account-gone, and the decrypt Worker stops
with it. `/history` carries no entry id, so no ids reach browser history.

### 15.18 Copy

The `history.*` keys, `home.pane.history` and `a11y.history.track` in
`shared/i18n/keys.ts`; it reuses `checkin.eyebrow.*`,
`checkin.step.3/4/5/8.pole.*`, `checkin.step.6.confidence.*`,
`checkin.afterEvent.badge`, `a11y.slider.*`, `checkin.otherWindow*`,
`settings.data.unreadable.*` and dictionary labels. No plural keys: the pane
shows no counts. Factual and short: no "why" or invitation to reflect, no praise
or evaluation, no reassurance that interprets, no counts framed as goals.
"check-in" is the noun for a record (ru/uk «запись / запис»); the pane is
"History" / «История» / «Історія», which does not clash with the "Check-in" /
«Запись» tab. General rules: copy.md §1.

### 15.19 Tests

Unit (`client/src/lib/history_test.ts`): every case of ui.md §15.8, local days
across a timezone and DST change, the timezone marker only on travel, page
rounding, delete writing a tombstone and an outbox `delete` and **no draft**,
draft gating. Browser (`make e2e`): open, expand, delete; offline delete → sync
→ another context loses the row; two-tab broadcast; draft gating via Close; axe,
44 px targets and CSP in all 10 presets; 320 px in ru and uk.

## 16. Assets and the mark

### 16.1 Reference images and prototype

`design/` (Calm unless noted): `00-overview.png` (phone screens, the flow,
desktop); `01-home.png` … `08-desktop.png` (single screens);
`07-check-in-flow.png` (all 16 flow states: front, back, whole body, the word's
3 states, "other" focused, the note filter); `09-theme-presets.png` (10 presets
× 4 steps, base colour and gradient examples, with unbuilt variants, ui.md
§14.9); `12-settings-appearance.png` (Calm, and Dusk with Rose and a Lilac
gradient); `11-emo-all-designs.png` (everything).

`design/prototype/*.dc.html` are canvas components (HTML plus a `DCLogic` class)
that need the canvas runtime: read them for logic and exact values, never as
production code. `Main` (the interactive check-in: state machine, swipe,
keyboard, focus, hit targets, note validator, "other"), `Screen` (the
theme-driven renderer: every variant's styles), `ThemeGallery` (preset data,
colour and gradient examples), `Flow` (static step states), `Settings` (all
settings with Appearance; the original `TINT` and `PRESETS`), `Login`,
`Passphrase`, `Recovery`, `Desktop`. Where they differ from the code, the code
and this file win.

### 16.2 The mark

`shared/brand.ts` (`MARK_DISCS`, `nestDiscs`, `MARK_ALPHA`, `MARK_RADIUS`,
`MARK_LIFT`, `MARK_VIEWBOX`):

- Six discs of the one highlight colour (ui.md §1.7), each 0.77 of the disc it
  rests in and sunk low inside it; each rests 24° further round, so the layers
  curl in toward the core like sheets of thin paper laid one on another:
  attention settling into the body.
- The five outer discs are 26 % opaque, the core solid, so the tone deepens
  toward the core on any ground: indigo on light, periwinkle on dark.
- In a 100 × 100 box the outer disc is centred on (50, 50), radius 34. On a
  square icon it sits a little up and right (`MARK_LIFT`), where its weight, low
  in the core, looks centred.
- No face, heart, emoji or warm colour (ui.md §1.6).
- In the app (`client/src/components/common/Mark.svelte`, `aria-hidden`,
  `currentColor` for forced colours) it stands before the wordmark: 22 px in the
  pane bar (ui.md §3), 30 px on the sign-in card. Home's Now is the same nest in
  the accent, with a core large enough for its label, that a mouse, a drag or a
  tilt can lean (`nestCurl`, `client/src/lib/bead.ts`).
- The static pages (`methodology.html`, `privacy.html`) show `mark.svg` beside
  the name; their mark links to the app.

### 16.3 App icons

`deno run -A tools/gen_icons.ts` draws every file below from `shared/brand.ts`
into `client/public/` (the master into `design/`), in pure Deno at 6×6 samples a
pixel. Never edit the PNGs by hand: change the mark and regenerate.

- `design/icon-master.svg` / `.png`: 1024×1024, full bleed, the mark on Calm
  ground `#E4EDF1`.
- `icon-192.png`, `icon-512.png`: `purpose: "any"`, rounded corners (manifest).
- `icon-maskable-512.png`: full-bleed ground, the mark inside the central 80 %
  (Android adaptive icons).
- `apple-touch-icon.png`: 180×180, no transparency; iOS rounds the corners.
- `badge-96.png`: the mark white on transparent, layers at 34 % so they read
  where only alpha is kept (the Android status-bar `badge`).
- `favicon.svg`, `favicon.ico` (32): the mark a little larger (37 % radius) so
  its layers read at 16 px; the SVG turns to Dusk ground and periwinkle when the
  system is dark.
- `mark.svg`: the mark alone, cropped to its outer disc, light / dark like the
  favicon; for the static pages.

All icons stay within 60 KB (performance.md §1.1). No iOS startup images: iOS
shows `background_color` while the shell loads, under 0.5 s warm (performance.md
§1.2). The build adds each file's hash to its URL in the manifest and
`index.html` (`/icon-192.png?v=1a2b3c4d`), so a new icon changes the manifest
and an installed app picks it up on Chrome's update check; iOS never refreshes a
home-screen icon, only re-adding the app does.

### 16.4 Manifest

`client/public/manifest.webmanifest`: `id: "/"`, `name` / `short_name` "Emo",
`description` "One-minute check-ins on what the body notices. Encrypted on your
device.", `start_url` and `scope` `/`, `display: "standalone"`,
`background_color` / `theme_color` `#E4EDF1` (the per-theme status-bar colour is
set at runtime, ui.md §14.3), one shortcut "Check in now" → `/now` (a manual
check-in; a closed draft stays behind "Continue", ui.md §6.2). No `orientation`,
`screenshots`, `display_override`, `launch_handler` or app badging.

## 17. Not in v1

v1 is the check-in, History, Settings, auth and onboarding, and Appearance.
Nothing below is built, and nothing shows a placeholder for it.

- **Reports, AI chat, other modules**: only a registry slot between History and
  Settings (`client/src/lib/panes.ts`, ui.md §2.2). AI chat needs a privacy
  decision first: decrypted data would leave the device.
- **Charts in History** (sparklines, mood over time, situation breakdowns) wait
  for Reports and the methodology's guards (methodology.md §5.2, methodology.md
  §5.4); also no date jump, no "discuss in session" flag, no printing or sharing
  one entry.
- **Import of the encrypted export** (`emo-bundle`): export only; it is readable
  offline with `emo decrypt-bundle` (architecture.md §10).
- **Theme editor, custom themes, sharing, a public gallery**: the `ThemeV1`
  schema stays complete (ui.md §14.2) so they need no migration.
- **Theme-dependent measurement controls and highlight** (`bloom`, `ruler`,
  `grouped`, `list`, `inline`, `segmented` certainty, `soft` / `hatch` / `glow`,
  figure labels): specs kept as reserved in ui.md §14.4; each needs a
  methodological decision and its `ui` record.
- **Alternative valence controls**: valence stays a bipolar slider.
- **A dark theme by time of day**: "Match the system" follows the device's
  setting instead (ui.md §13.2).
- **iOS startup images** (ui.md §16.3).
