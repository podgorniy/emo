<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import { onMount, tick } from "svelte";
  import type { AccountInfo, KeyringItem } from "../../shared/protocol.ts";
  import type { TriggerType } from "../../shared/entry.ts";
  import {
    apiLogout,
    setAccountGoneHandler,
    setSignedOutHandler,
    getCompat,
    onCompatChange,
    type CompatState,
  } from "./lib/api.ts";
  import { initCryptoFromStorage, lockDevice, isLocked } from "./lib/crypto.ts";
  import {
    fxOff,
    getAppearance,
    getTheme,
    initTheme,
    onThemeChange,
    setAppearance,
  } from "./lib/theme.ts";
  import { initLocale } from "./lib/i18n.ts";
  import { runSync, startSyncTriggers } from "./lib/sync.ts";
  import { setEpochMismatchHandler } from "./lib/api.ts";
  import { broadcast, onBroadcast } from "./lib/channel.ts";
  import { applyStoredPrefs, forgetPrefsEmail } from "./lib/prefs.ts";
  import {
    closeDatabase,
    deleteLocalDatabase,
    setVersionChangeHandler,
  } from "./lib/db.ts";
  import { refreshPushSubscription } from "./lib/push.ts";
  import { requestPersistence } from "./lib/storage.ts";
  import { checkForUpdate } from "./lib/update.ts";
  import { onOfflineChange, startNetworkWatch } from "./lib/network.ts";
  import { errorCode, recordDiag } from "./lib/diag.ts";
  import { getLocale, setLocale, t } from "./lib/i18n.svelte.ts";
  import {
    cachedAccount,
    cachedKeyring,
    checkSession,
    fetchKeyring,
    isSignedOut,
    localCheckIns,
    rememberAccount,
    setSignedOut,
    wipeThisDevice,
  } from "./lib/session.ts";
  import { forgetDraftInMemory, loadDraft } from "./lib/draft.ts";
  import { holdsDraftLock } from "./lib/draftLock.ts";
  import { finalizeIfAbandoned, skipOpenDraft, undoCheckIn } from "./lib/checkin.ts";

  import type * as AuthScreens from "./components/auth/screens.ts";
  import { isRecoveryPending, setRecoveryPending } from "./lib/recoveryPending.ts";
  import { setSessionEmail } from "./lib/sessionEmail.ts";
  import Home from "./components/home/Home.svelte";
  import CheckInFlow from "./components/flow/CheckInFlow.svelte";
  import OfflineBand from "./components/common/OfflineBand.svelte";
  import PaneBar from "./components/common/PaneBar.svelte";
  import UpdateCard from "./components/common/UpdateCard.svelte";
  import ConfirmSheet from "./components/common/ConfirmSheet.svelte";
  import type Settings from "./components/settings/Settings.svelte";
  import type History from "./components/history/History.svelte";
  import type Aura from "./components/common/Aura.svelte";
  import { PANES, type PaneId } from "./lib/panes.ts";
  import { arrive, cueArrival, DUR, motionOK, swap, swapCard } from "./lib/motion.ts";
  import { PHONE, type Reach, startPageReach } from "./lib/reach.ts";
  import {
    dropStale,
    handlePopstate as handleSheetPopstate,
    hasOpenSheet,
    settled,
    unwindAll,
  } from "./lib/sheets.ts";
  import { forget, fromSaved, type LastSaved, savedAt, undoLeft } from "./lib/lastSaved.ts";
  import { refreshViewport } from "./lib/viewport.ts";

  type ViewState =
    | "loading"
    | "storage_damaged"
    | "login"
    | "setup_passphrase"
    | "recovery_key_display"
    | "onboarding_finish"
    | "recovery_pending"
    | "unlock"
    | "recover"
    | "home"
    | "flow"
    | "settings"
    | "history";

  let currentView = $state<ViewState>("loading");
  /** The pane on screen, when it is one (the pane bar shows then) */
  const paneView = $derived<PaneId | null>(
    currentView === "home" || currentView === "settings" || currentView === "history"
      ? currentView
      : null,
  );
  let account = $state<AccountInfo | null>(null);
  let newRecoveryKey = $state<string | null>(null);
  let currentKeyring = $state<KeyringItem | null>(null);
  /** The check-in just saved, while Home's Undo lasts (lib/lastSaved.ts) */
  let lastSaved = $state<LastSaved | null>(null);
  let compat = $state<CompatState>(getCompat());
  /** A 401: local recording works, syncing waits for a new sign-in. */
  let signedOut = $state(false);
  /**
   * reliability.md §1.3, one account per browser: the choice between the
   * account this device holds and another one, signed in as (`verified`) or
   * about to be. What clearing would lose is counted when it opens.
   */
  let accountSwitch = $state<
    {
      verified: VerifiedAccount | null;
      email: string | null;
      entries: number;
      unsynced: number;
    } | null
  >(null);
  /** The form was reopened by an Undo from the Home toast. */
  let flowUndone = $state(false);
  /** What started the check-in on screen (ui.md §6.1). */
  let flowTrigger = $state<TriggerType>("manual");
  let flowReminderId = $state<string | null>(null);
  /** A check-in asked for before the app could open one (locked, booting). */
  let pendingCheckIn: { trigger: TriggerType; reminderId: string | null } | null = null;

  type VerifiedAccount = { id: string; created: boolean; has_keyring: boolean };

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  // ----- Routes (ui.md §2.2): `/` Home, `/settings`, `/now`,
  // `/history` -----
  // Home is the base history entry; Settings, History and the form are pushed
  // on top of it, so the browser's (and Android's) Back closes them instead of
  // leaving the app mid check-in. The draft is saved after every step.
  const ROUTES: Partial<Record<ViewState, string>> = {
    home: "/",
    settings: "/settings",
    flow: "/now",
    history: "/history",
  };
  let routed: ViewState | null = null;
  let fromHistory = false;
  /** `/settings` (or `/settings#appearance`) asked for at start */
  let pendingSettings: string | null = location.pathname === "/settings"
    ? location.hash
    : null;
  /** `/history` asked for at start: opened after unlock (ui.md §15.3) */
  let pendingHistory = location.pathname === "/history";

  /**
   * Sheets have history entries of their own above the view's
   * (lib/sheets.ts, ui.md §2.2). No view change writes history
   * while one is on top: `unwindAll()` closes the open sheets, pops their
   * entries and waits until history is settled, else a push or a replace
   * would land on a sheet's entry and its pending Back would then undo the
   * new view's. View changes write history one at a time, in order.
   */
  let routing = Promise.resolve();

  $effect(() => {
    const view = currentView;
    const path = ROUTES[view];
    if (!path) return;
    const previous = routed;
    routed = view;
    if (fromHistory) {
      fromHistory = false;
      return;
    }
    routing = routing
      .then(unwindAll)
      .then(() => route(view, previous, path))
      .catch((err) => console.warn("Route not written:", err));
  });

  function route(view: ViewState, previous: ViewState | null, path: string) {
    if (view === "home") {
      if (previous && previous !== "home" && history.state?.emo) history.back();
      else if (location.pathname !== "/") history.replaceState(null, "", "/");
      return;
    }
    const url = path + (view === "settings" ? location.hash : "");
    if (previous === null || previous === "home") {
      if (location.pathname !== "/") history.replaceState(null, "", "/");
      history.pushState({ emo: view }, "", url);
    } else {
      history.replaceState({ emo: view }, "", url);
    }
  }

  globalThis.addEventListener("popstate", (e) => {
    // Back over a sheet closes the sheet, and a sheet's own pops are its
    // own (lib/sheets.ts): neither changes the view
    if (handleSheetPopstate(e)) return;
    const path = location.pathname;
    const next: ViewState | null = path === "/settings"
      ? "settings"
      : path === "/now"
      ? "flow"
      : path === "/history"
      ? "history"
      : path === "/"
      ? "home"
      : null;
    // History moves between Home, Settings, History and the form only
    if (!next || next === currentView) return;
    if (!["home", "settings", "flow", "history"].includes(currentView)) return;
    fromHistory = true;
    if (next === "flow") startCheckIn("manual");
    else void openPane(next);
  });

  /**
   * A reload (or a restored tab) with a sheet open left its entry on top,
   * with the view's entry under it: Back over it before any history is
   * written at start (lib/sheets.ts `dropStale`), so no later Back lands on
   * it or reopens the view under it. Resolves once that pop has landed.
   */
  const staleSheet: Promise<void> | null = dropStale() ? settled() : null;

  /**
   * The auth screens are one lazy chunk (performance.md §3.3). A device
   * without keys starts loading it at boot, next to the session check; on an
   * unlocked one it is fetched when idle, or when an auth screen is needed.
   */
  const AUTH_VIEWS: ReadonlySet<ViewState> = new Set([
    "login",
    "setup_passphrase",
    "recovery_key_display",
    "onboarding_finish",
    "recovery_pending",
    "unlock",
    "recover",
  ]);
  let Auth = $state<typeof AuthScreens | null>(null);
  let authLoad: Promise<void> | null = null;
  function loadAuth() {
    authLoad ??= import("./components/auth/screens.ts").then(
      (m) => { Auth = m; },
      (err) => {
        authLoad = null; // the next auth screen tries again
        void recordDiag(errorCode(err), "boot");
      },
    );
  }
  $effect(() => {
    if (AUTH_VIEWS.has(currentView)) loadAuth();
  });

  /** Settings is a lazily loaded pane (lib/panes.ts), fetched when idle. */
  let SettingsView = $state<typeof Settings | null>(null);
  function loadSettings() {
    const pane = PANES.find((p) => p.id === "settings");
    void pane?.load?.().then((m) => {
      SettingsView = m.default as unknown as typeof Settings;
    });
  }

  /**
   * The ambient light (ui.md §13.7): moving behind Home
   * and the sign-in screens, a still picture behind History and Settings (so
   * a pane change shows no seam), gone for the check-in and Saved. Not at
   * all where the theme has none (Ink, Mono, Paper) or the device asks for
   * more contrast. A lazy chunk, fetched when idle after the first screen.
   */
  let AuraView = $state<typeof Aura | null>(null);
  let auraStrength = $state(fxOff() ? 0 : getTheme().fx.bg);
  let auraStill = $state(getAppearance().still === true);
  onThemeChange((theme) => {
    auraStrength = fxOff() ? 0 : theme.fx.bg;
    auraStill = getAppearance().still === true;
  });
  const auraMode = $derived(
    currentView === "home" || AUTH_VIEWS.has(currentView)
      ? "moving"
      : currentView === "settings" || currentView === "history"
      ? "still"
      : null,
  );
  let auraLoad: Promise<void> | null = null;
  $effect(() => {
    if (!auraMode || auraStrength <= 0 || auraLoad) return;
    const idle = globalThis.requestIdleCallback ?? ((fn) => setTimeout(fn, 600));
    auraLoad = new Promise<void>((resolve) => idle(() => resolve()))
      .then(() => import("./components/common/Aura.svelte"))
      .then((m) => {
        AuraView = m.default;
      }, () => {
        auraLoad = null; // tried again on the next screen that has it
      });
  });

  /** History is loaded on first open, never ahead (ui.md §15.3). */
  let HistoryView = $state<typeof History | null>(null);
  function loadHistory() {
    const pane = PANES.find((p) => p.id === "history");
    void pane?.load?.().then((m) => {
      HistoryView = m.default as unknown as typeof History;
    });
  }

  /**
   * A dot, a tab or the long press in the pane bar: straight to that pane,
   * then focus on its heading (Home: the Now button), ui.md §2.2
   */
  async function openFromBar(id: PaneId) {
    openPane(id);
    await tick();
    let tries = 0;
    const focus = () => {
      const el = document.querySelector<HTMLElement>(
        id === "home" ? "button.now" : "h1[tabindex]",
      );
      if (el) el.focus({ preventScroll: true });
      else if (tries++ < 120) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }

  /** Where each pane sits in the row: a move right goes forward (ui.md §2.1) */
  const paneIndex = (id: PaneId) => PANES.findIndex((p) => p.id === id);

  /**
   * The pane's code, so a transition shows the pane and not a spinner; a
   * pane not ready in 150 ms opens without one (History still loads only
   * when asked for, ui.md §15.3)
   */
  async function paneReady(id: PaneId): Promise<boolean> {
    if (id === "home" || (id === "settings" ? SettingsView : HistoryView)) return true;
    if (id === "settings") loadSettings();
    else loadHistory();
    const loaded = PANES.find((p) => p.id === id)?.load?.()
      .then(() => tick())
      .then(() => true, () => false) ?? Promise.resolve(false);
    return await Promise.race([
      loaded,
      new Promise<boolean>((r) => setTimeout(() => r(false), 150)),
    ]);
  }

  /**
   * Another pane: sideways, 32 px and a crossfade, while the pane bar, the
   * dots and the light behind stay still (ui.md §5.1); without
   * View Transitions the new pane settles in from 24 px. Any tap or key ends
   * it at once.
   */
  async function openPane(id: PaneId) {
    // A sheet still open (the pane bar's) closes first, its entry with it
    if (hasOpenSheet()) await unwindAll();
    const go = () => {
      if (id === "settings") {
        loadSettings();
        currentView = "settings";
      } else if (id === "history") {
        loadHistory();
        currentView = "history";
      } else currentView = "home";
    };
    const from = paneView;
    if (!from || from === id || !motionOK()) {
      go();
      return;
    }
    if (!(await paneReady(id))) {
      if (currentView === from) go();
      return;
    }
    // Something else happened meanwhile (the form opened, a lock)
    if (currentView !== from) return;
    const fwd = paneIndex(id) > paneIndex(from);
    await swap(fwd ? "pane-fwd" : "pane-back", go, () =>
      arrive(document.querySelector("[data-pane]"), fwd ? "fwd" : "back", {
        offset: 24,
        duration: DUR[4],
      }));
  }

  /**
   * An auth screen to the next: the card keeps its place, its size morphs
   * and its content crossfades (ui.md §5.1); other moves are
   * plain.
   */
  function setView(next: ViewState) {
    const from = currentView;
    if (Auth && from !== next && AUTH_VIEWS.has(from) && AUTH_VIEWS.has(next)) {
      void swapCard(from === "recover" ? "back" : "fwd", () => {
        currentView = next;
      });
    } else currentView = next;
  }

  /**
   * `/now?reminder=<id>` — a notification tap (architecture.md §9.2): a random
   * check-in tied to that reminder; `/now` alone is a manual one. The URL is
   * then put back to `/`.
   */
  function takeCheckInUrl(path: string): boolean {
    const url = new URL(path, location.origin);
    if (url.pathname !== "/now") return false;
    const id = url.searchParams.get("reminder");
    pendingCheckIn = id && UUID_RE.test(id)
      ? { trigger: "random", reminderId: id }
      : { trigger: "manual", reminderId: null };
    const toRoot = () => {
      if (location.pathname !== "/") history.replaceState(null, "", "/");
    };
    // Never over a sheet's entry from before a reload: once it is gone
    if (staleSheet) void staleSheet.then(toRoot);
    else toRoot();
    return true;
  }

  function startCheckIn(trigger: TriggerType, reminderId: string | null = null) {
    // A new check-in: the last one's Undo is over (lib/lastSaved.ts)
    lastSaved = null;
    flowTrigger = trigger;
    flowReminderId = reminderId;
    flowUndone = false;
    currentView = "flow";
  }

  /**
   * Opens a pending check-in once a pane is on screen — Home, History or
   * Settings (ui.md §15.2); an open form keeps its own; auth,
   * lock and recovery wait for enterHome().
   */
  function openPendingCheckIn() {
    // An open form keeps its own (reliability.md §2.3): the tap is spent, not
    // kept for the next unlock
    if (pendingCheckIn && currentView === "flow") pendingCheckIn = null;
    if (!pendingCheckIn || paneView === null) return;
    const { trigger, reminderId } = pendingCheckIn;
    pendingCheckIn = null;
    startCheckIn(trigger, reminderId);
  }

  takeCheckInUrl(location.pathname + location.search);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", async (e: MessageEvent) => {
      if (e.data?.type !== "open-url") return;
      // An open form keeps its own (reliability.md §2.3): the tap is spent,
      // and its history (its help sheet's entry too) stays as it is
      if (currentView === "flow") return;
      // Over a sheet: the sheet and its entry go before the URL changes
      if (hasOpenSheet()) await unwindAll();
      if (takeCheckInUrl(e.data.url)) openPendingCheckIn();
    });
  }

  // A 426 means a newer app is deployed: look for its service worker now
  onCompatChange((state) => {
    compat = state;
    if (state === "update_required") void checkForUpdate(true);
  });

  // The offline band on every screen (ui.md §3.6)
  let offline = $state(false);
  startNetworkWatch();
  onOfflineChange((value) => (offline = value));

  // A server restore noticed outside a sync pass: the pass re-uploads (data.md §5.4 0a)
  setEpochMismatchHandler(() => {
    if (account) runSync(account.id).catch((err) => console.warn("Sync error:", err));
  });

  // reliability.md §1.1: another tab needs a newer database version; this
  // tab's connection is closed already (a save in progress completes first)
  let reloading = $state(false);
  function reloadForUpgrade() {
    reloading = true;
    closeDatabase();
    location.reload();
  }
  setVersionChangeHandler(reloadForUpgrade);

  /**
   * The storage-damaged screen (reliability.md §1.1): "Try again" reloads,
   * since an open that failed once (a lost connection) often works again;
   * "Reset this device" only after a destructive confirm, as it loses what
   * has not reached the server. The local database goes, the session
   * cookie stays.
   */
  let confirmReset = $state(false);
  let resetting = $state(false);
  async function resetDevice() {
    resetting = true;
    await deleteLocalDatabase().catch(() => {});
    location.reload();
  }

  // Other tabs (reliability.md §1.3): apply their changes without a reload
  onBroadcast(async (msg) => {
    if (msg.type === "db-upgrade") {
      reloadForUpgrade();
      return;
    }
    if (msg.type === "prefs" && account) {
      await applyStoredPrefs(account.id).catch(() => {});
    } else if (msg.type === "locale") {
      await setLocale(msg.payload as "en" | "ru" | "uk");
    } else if (msg.type === "lock" && account) {
      await handleLock(false);
    } else if (msg.type === "signout") {
      // Let the signing-out tab delete the database, then start over
      closeDatabase();
      location.reload();
    } else if (msg.type === "draft-ping" && currentView === "flow" && holdsDraftLock()) {
      // "Go to it" from another tab: the one with the form open (R reliability.md §1.3),
      // not another tab showing that the form is open elsewhere
      globalThis.focus();
    }
  });

  /**
   * reliability.md §1.3: the account was deleted on another device. Sync
   * stops and one screen says so; the local copies are wiped only after the
   * person has seen it ("OK"), never before.
   */
  let accountGone = $state(false);
  function onAccountGone() {
    if (accountGone) return;
    accountGone = true;
    stopSyncTriggers?.();
    stopSyncTriggers = null;
  }
  setAccountGoneHandler(onAccountGone);

  async function acknowledgeAccountGone() {
    await wipeThisDevice().catch(() => {});
    account = null;
    signedOut = false;
    accountGone = false;
    currentView = "login";
  }

  // A 401 while the app is open: keep recording here, ask to sign in to sync
  setSignedOutHandler(() => {
    if (!account || currentView === "login") return;
    signedOut = true;
    void setSignedOut(true);
  });

  let stopSyncTriggers: (() => void) | null = null;
  function syncInBackground() {
    if (!account) return;
    stopSyncTriggers ??= startSyncTriggers(account.id);
    runSync(account.id).catch((err) => void recordDiag(errorCode(err), "sync"));
  }

  /** The route into the app for an account this device knows. */
  async function enterAccount(acc: AccountInfo, hasKeys: boolean) {
    account = acc;
    if (!acc.has_keyring) setView("setup_passphrase");
    else if (hasKeys && !isLocked()) await enterHome();
    else setView("unlock");
  }

  /**
   * The page's reach room (lib/reach.ts, ui.md §4.5): on a phone
   * every pane and sign-in screen can be pulled down until its top is in
   * the bottom third. A new screen rests with it out of view; a deep link
   * (`/settings#appearance`) keeps the place it scrolled to. The form has
   * its own, so none around it.
   */
  let pageReach: Reach | null = null;
  let roomEl: HTMLElement;
  let rootEl: HTMLElement;

  /**
   * Interim reach on the sign-in and unlock screens (MEAS-02, until the
   * auth screens are rebuilt): on a phone the page rests at its end, not at
   * its top, so a card taller than the screen (375×667; 390×664 under
   * Safari's bars) never cuts off its primary or its links; the room above
   * still pulls down. While at its end it stays there as the card loads or
   * grows (a meter, a hint, an error); a scroll away lets it be.
   */
  const phone = matchMedia(PHONE);
  const restsAtEnd = (view: ViewState) => phone.matches && AUTH_VIEWS.has(view);
  let atEnd = false;
  /** Where `toEnd` put the page: its own scroll event is no scroll away */
  let pinnedTop = -1;
  function toEnd() {
    const page = document.body; // the scroller (boot.css)
    page.scrollTop = page.scrollHeight - page.clientHeight;
    pinnedTop = page.scrollTop;
    atEnd = true;
  }

  onMount(() => {
    pageReach = startPageReach(roomEl, () => currentView !== "flow");
    const page = document.body;
    const onScroll = () => {
      // The event of a `toEnd` comes a frame later: the card may have grown
      // meanwhile, and it is still to stay at its end
      if (page.scrollTop === pinnedTop) return;
      pinnedTop = -1;
      atEnd = page.scrollTop >= page.scrollHeight - page.clientHeight - 1;
    };
    const grown = new ResizeObserver(() => {
      if (atEnd && restsAtEnd(currentView)) toEnd();
    });
    grown.observe(rootEl);
    page.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      pageReach?.stop();
      grown.disconnect();
      page.removeEventListener("scroll", onScroll);
    };
  });
  $effect(() => {
    const view = currentView;
    // A field that had focus may be gone, and the keyboard with it
    refreshViewport();
    if (location.hash) pageReach?.refresh();
    else pageReach?.rest();
    if (restsAtEnd(view)) toEnd();
  });
  // A new card in the same view (the account switch within sign-in) and the
  // auth chunk taking the spinner's place rest at the end too, once drawn
  $effect(() => {
    void accountSwitch;
    void Auth;
    void tick().then(() => {
      if (restsAtEnd(currentView)) toEnd();
    });
  });

  /**
   * Undo is Home's alone (lib/lastSaved.ts): any other screen ends it, and
   * so does the page going hidden (another app, the lock screen). Saved
   * from History ("Skip it"), it lasts on the way Home, never past its time.
   */
  $effect(() => {
    if (currentView !== "home") lastSaved = null;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) lastSaved = null;
  });

  /**
   * Boot from local state (reliability.md §5.2): a known account opens Home
   * (or unlock) at once, offline too; the network only refreshes the session.
   * Without local state, the server decides: signed in, or the sign-in screen.
   */
  onMount(async () => {
    try {
      await initTheme();
      await initLocale();
      const hasKeys = await initCryptoFromStorage();
      if (!hasKeys) loadAuth();
      let cached = await cachedAccount();
      // Without a keyring the cached record may be from before the upload:
      // the server decides (the only state the offline start cannot trust)
      if (cached && !cached.has_keyring) {
        const check = await checkSession();
        if (check.state === "ok") cached = check.account;
      }
      if (cached) {
        signedOut = await isSignedOut();
        await enterAccount(cached, hasKeys);
        void refreshSession();
        return;
      }
      const check = await checkSession();
      if (check.state === "ok") await enterAccount(check.account, hasKeys);
      else currentView = "login";
    } catch (err) {
      console.error("App boot error:", err);
      // reliability.md §1.1: the local database cannot be opened
      currentView = (err as Error)?.name === "StorageDamaged"
        ? "storage_damaged"
        : "login";
    }
  });

  /** In the background: a newer account record, or the news that the session ended. */
  async function refreshSession() {
    const check = await checkSession();
    if (check.state === "ok") {
      account = check.account;
      signedOut = false;
    } else if (check.state === "signed_out") {
      signedOut = true;
    } else if (check.state === "account_gone") {
      onAccountGone();
    }
  }

  /**
   * "Sign in to sync": the sign-in screen, local data kept. No sync meanwhile:
   * this sign-in may bring another account's session (reliability.md §1.3)
   */
  function handleSignInAgain() {
    stopSyncTriggers?.();
    stopSyncTriggers = null;
    currentView = "login";
  }

  /** "Back" from that screen: the account this device holds, as it was */
  async function backToDeviceAccount() {
    if (account) await enterAccount(account, !isLocked());
  }

  /** Signed in just now on a browser that did not hold this account */
  let newDevice = $state(false);

  /** The address just signed in with: only in memory, for the recovery-key file. */
  let signInEmail = $state<string | null>(null);

  async function handleVerified(acc: VerifiedAccount, email: string) {
    signInEmail = email;
    // The passphrase's username for password managers (memory only)
    setSessionEmail(email);
    const cached = await cachedAccount();
    if (cached && cached.id !== acc.id) {
      // reliability.md §1.3: never mix two accounts' data on one device
      accountSwitch = { verified: acc, email, ...(await localCheckIns()) };
      return;
    }
    await continueAs(acc);
  }

  /** "Use a different account" on the sign-in screen, before any code */
  async function openAccountSwitch() {
    accountSwitch = { verified: null, email: null, ...(await localCheckIns()) };
  }

  /**
   * Clears this browser, then goes on as the account just signed in as, or
   * to a plain sign-in. The theme goes back to the default with the data.
   */
  async function clearDeviceAndContinue() {
    const verified = accountSwitch?.verified ?? null;
    forgetDraftInMemory();
    await wipeThisDevice();
    setAppearance(null);
    account = null;
    currentKeyring = null;
    lastSaved = null;
    signedOut = false;
    accountSwitch = null;
    if (verified) await continueAs(verified);
    else currentView = "login";
  }

  /**
   * "Back": keep the account this device holds. After a sign-in as another
   * one, that session ends here; before one, the sign-in screen again.
   */
  async function keepDeviceAccount() {
    const signedInOther = accountSwitch?.verified != null;
    accountSwitch = null;
    if (!signedInOther) return;
    await apiLogout().catch(() => {});
    await backToDeviceAccount();
  }

  /** Signed in, as the account this device holds or on a cleared one */
  async function continueAs(acc: VerifiedAccount) {
    // Unlock reads "New device" when this browser did not hold the account
    newDevice = (await cachedAccount())?.id !== acc.id;
    signedOut = false;
    await setSignedOut(false);
    const check = await checkSession();
    const fresh: AccountInfo = check.state === "ok" ? check.account : {
      id: acc.id,
      locale: getLocale(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      has_keyring: acc.has_keyring,
      current_key_version: 1,
    };
    if (check.state !== "ok") await rememberAccount(fresh);
    if (fresh.has_keyring) void fetchKeyring();
    await enterAccount(fresh, !isLocked());
  }

  function handlePassphraseSetupCompleted(recKeyFormatted: string) {
    newRecoveryKey = recKeyFormatted;
    setView("recovery_key_display");
  }

  /** Step 2 → step 3 (install and reminders) → Home */
  async function handleRecoveryKeyAcknowledged() {
    await setRecoveryPending(false);
    newRecoveryKey = null;
    setView("onboarding_finish");
    syncInBackground();
  }

  /** Unlocked: a draft idle ≥ 10 min is saved as abandoned first (ui.md §6.2). */
  async function enterHome() {
    // H48: a recovery key that was shown but never saved comes first
    if (await isRecoveryPending()) {
      setView("recovery_pending");
      return;
    }
    currentView = "home";
    if (!account) return;
    // The chosen theme lives only in encrypted prefs (ui.md §14.8)
    void applyStoredPrefs(account.id).catch(() => {});
    // architecture.md §9.4: the subscription is checked on every open, so a
    // device the push service rotated keeps getting reminders;
    // reliability.md §5.1: storage persistence is asked again too
    void refreshPushSubscription().catch(() => {});
    void requestPersistence();
    // A bare `/now` at start (a restored tab, a reload after Close) does not
    // reopen a check-in the person closed: it waits behind "Continue" (ui.md §6.2)
    if (pendingCheckIn?.trigger === "manual") {
      const draft = await loadDraft(account.id).catch(() => null);
      if (draft?.closed_by_user) pendingCheckIn = null;
    }
    openPendingCheckIn();
    // A sheet entry from before the reload is gone first (`staleSheet`)
    if (staleSheet) await staleSheet;
    if (pendingSettings !== null && currentView === "home") {
      const hash = pendingSettings;
      pendingSettings = null;
      history.replaceState(null, "", `/${hash}`);
      openPane("settings");
    } else if (pendingHistory && currentView === "home") {
      pendingHistory = false;
      history.replaceState(null, "", "/");
      openPane("history");
    } else {
      // The Settings chunk, ahead of the first tap (performance.md §1.2)
      const idle = globalThis.requestIdleCallback ?? ((fn) => setTimeout(fn, 2000));
      idle(() => {
        loadSettings();
        loadAuth();
      });
    }
    try {
      await finalizeIfAbandoned(account.id, account.current_key_version || 1);
    } catch (err) {
      console.warn("Abandoned draft not finalized:", err);
    }
    // ui.md §6.2: a check-in in progress resumes on its step
    // after a reload, an eviction or a restart, once the abandon rule has
    // run — but never one the person closed: that one waits on Home
    if (currentView === "home") {
      const draft = await loadDraft(account.id).catch(() => null);
      if (draft && !draft.closed_by_user && currentView === "home") {
        startCheckIn(draft.trigger, draft.reminder_id);
      }
    }
    syncInBackground();
  }

  function handleUnlocked() {
    enterHome();
  }

  async function handleNeedRecovery() {
    // Recovery writes a new revision, so it wants the newest one; offline,
    // the cached one (the upload then waits for the network)
    currentKeyring = (await fetchKeyring()) ?? (await cachedKeyring());
    if (currentKeyring) setView("recover");
  }

  // RecoveryUnlock already stored the new keyring revision on the server.
  function handleRecovered() {
    currentKeyring = null;
    currentView = "home";
    syncInBackground();
  }

  /**
   * "Skip it" on Home or in History: the open check-in ends as stopped, with
   * Undo on Home. Once at a time: a second call waits for the first.
   */
  let skipping: Promise<void> | null = null;
  function handleSkipDraft(): Promise<void> {
    skipping ??= skipDraft().finally(() => (skipping = null));
    return skipping;
  }
  async function skipDraft() {
    if (!account) return;
    try {
      const entry = await skipOpenDraft(account.id, account.current_key_version || 1);
      if (entry) lastSaved = savedAt(entry.id);
    } catch (err) {
      console.error("Check-in not skipped:", err);
    }
  }

  function handleCheckInCompleted(entryId: string, savedTime: number | null) {
    // Undo on Home for 10 s from here, by the clock, and never once the page
    // was hidden or Saved stood past its 5 s (lib/lastSaved.ts)
    lastSaved = fromSaved(entryId, savedTime);
    // Home comes back out (ui.md §5.1)
    cueArrival("flow");
    currentView = "home";
  }

  /** Home toast Undo: the answers come back as the draft; the form re-opens on them. */
  async function handleUndo(entryId: string) {
    // Only the last save, and only within its time (lib/lastSaved.ts)
    if (!account || lastSaved?.id !== entryId || undoLeft(lastSaved) === 0) return;
    try {
      await undoCheckIn(account.id, entryId);
      lastSaved = null;
      startCheckIn("manual");
      flowUndone = true;
    } catch (err) {
      console.error("Undo failed:", err);
    }
  }

  /** Lock here, and (unless another tab asked) in the other tabs too */
  async function handleLock(tellOthers = true) {
    forgetDraftInMemory();
    lastSaved = null;
    stopSyncTriggers?.();
    stopSyncTriggers = null;
    await lockDevice();
    if (tellOthers) broadcast({ type: "lock" });
    newDevice = false;
    // Locked, the account's address is not shown again (not even in the
    // hidden username field) until the prefs are readable (ui.md §12.5)
    setSessionEmail(null);
    forgetPrefsEmail();
    currentView = "unlock";
    // Unlocking lands on Home, not on the pane that was open (UX-17). The
    // URL once the pane's sheets have gone with it, and their history
    // entries (lib/sheets.ts), so the replace lands on the pane's own
    await tick();
    await unwindAll();
    if (location.pathname !== "/") history.replaceState(null, "", "/");
  }

  /** Signed out or account deleted: the local data is gone; start over. */
  async function handleLoggedOut() {
    account = null;
    // The next sign-in lands on Home, not in Settings where this started:
    // only a link that opened the app is kept across a sign-in (UX-17);
    // the confirm sheet's own entry goes first (lib/sheets.ts)
    await tick();
    await unwindAll();
    history.replaceState(null, "", "/");
    location.reload();
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (hasOpenSheet()) return;
      if (currentView === "settings" || currentView === "history") {
        e.preventDefault();
        void openPane("home");
      }
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<!-- The page's reach room, out of view at rest (lib/reach.ts) -->
<div class="reach-room" aria-hidden="true" bind:this={roomEl}></div>
<div class="app-root" class:offline bind:this={rootEl}>
  {#if AuraView && auraMode && auraStrength > 0 && !reloading && !accountGone}
    <AuraView moving={auraMode === "moving" && !auraStill} screen={currentView} />
  {/if}
  <OfflineBand {offline} />
  {#if reloading}
    <p class="app-notice" role="status">{t("common.reloading")}</p>
  {:else if accountGone}
    <main class="damaged">
      <p role="alert">{t("errors.accountGone")}</p>
      <button type="button" class="damaged-reset" onclick={acknowledgeAccountGone}>
        {t("common.ok")}
      </button>
    </main>
  {:else if currentView === "loading"}
    <div class="loading-screen">
      <div class="loading-spinner"></div>
    </div>
  {:else if currentView === "storage_damaged"}
    <main class="damaged">
      <p role="alert">{t("errors.storageDamaged")}</p>
      <div class="damaged-actions">
        <button type="button" class="damaged-reset" onclick={() => location.reload()}>
          {t("errors.storageDamaged.retry")}
        </button>
        <button
          type="button"
          class="damaged-other text-action"
          onclick={() => (confirmReset = true)}
        >
          {t("errors.storageDamaged.reset")}
        </button>
      </div>
    </main>
    {#if confirmReset}
      <ConfirmSheet
        title={t("errors.storageDamaged.confirm.title")}
        confirmLabel={t("errors.storageDamaged.reset")}
        destructive
        busy={resetting}
        onconfirm={resetDevice}
        oncancel={() => (confirmReset = false)}
      >
        <p>{t("errors.storageDamaged.confirm.body")}</p>
      </ConfirmSheet>
    {/if}
  {:else if AUTH_VIEWS.has(currentView) && !Auth}
    <div class="loading-screen"><div class="loading-spinner"></div></div>
  {:else if currentView === "login" && Auth}
    {#if accountSwitch}
      <Auth.AccountSwitch
        email={accountSwitch.email}
        entries={accountSwitch.entries}
        unsynced={accountSwitch.unsynced}
        onClear={clearDeviceAndContinue}
        onBack={keepDeviceAccount}
      />
    {:else}
      <Auth.Login
        deviceAccount={account !== null}
        onVerified={handleVerified}
        onSwitchAccount={openAccountSwitch}
        onBack={backToDeviceAccount}
      />
    {/if}
  {:else if currentView === "setup_passphrase" && account && Auth}
    <Auth.PassphraseSetup
      accountId={account.id}
      onCompleted={handlePassphraseSetupCompleted}
    />
  {:else if currentView === "recovery_key_display" && newRecoveryKey && Auth}
    <Auth.RecoveryKeyDisplay
      recoveryKey={newRecoveryKey}
      email={signInEmail}
      onConfirmed={handleRecoveryKeyAcknowledged}
    />
  {:else if currentView === "recovery_pending" && account && Auth}
    <Auth.RecoveryPending accountId={account.id} onDone={enterHome} />
  {:else if currentView === "onboarding_finish" && account && Auth}
    <Auth.OnboardingFinish onDone={enterHome} />
  {:else if currentView === "unlock" && account && Auth}
    <Auth.PassphraseUnlock
      accountId={account.id}
      {newDevice}
      onUnlocked={() => {
        newDevice = false;
        handleUnlocked();
      }}
      onNeedRecovery={handleNeedRecovery}
    />
  {:else if currentView === "recover" && account && currentKeyring && Auth}
    <Auth.RecoveryUnlock
      accountId={account.id}
      {currentKeyring}
      onRecovered={handleRecovered}
      onCancel={() => setView("unlock")}
    />
  {/if}
  <!-- One switcher for the three panes, never re-mounted between them
       (ui.md §2.2); none in the check-in or on auth screens -->
  {#if account && paneView && !reloading && !accountGone}
    <PaneBar
      current={paneView}
      {signedOut}
      {compat}
      onSignIn={handleSignInAgain}
      onSync={() => syncInBackground()}
      onopen={openFromBar}
    />
    <!-- The update notice, at the same place on every pane (ui.md §3) -->
    <UpdateCard {compat} {offline} />
  {/if}
  {#if reloading || accountGone}
    <!-- their screens are above -->
  {:else if currentView === "home" && account}
    <Home
      {account}
      {compat}
      onStartCheckIn={() => startCheckIn("manual")}
      onAfterEvent={() => startCheckIn("after_event")}
      onSkipDraft={handleSkipDraft}
      onOpenPane={(id) => void openPane(id)}
      {lastSaved}
      onUndoLastEntry={handleUndo}
      onClearLastEntry={() => { lastSaved = null; }}
    />
  {:else if currentView === "flow" && account}
    <CheckInFlow
      accountId={account.id}
      keyVersion={account.current_key_version || 1}
      trigger={flowTrigger}
      reminderId={flowReminderId}
      undone={flowUndone}
      onsaved={(id, at) => { flowUndone = false; handleCheckInCompleted(id, at); }}
      onexit={() => { flowUndone = false; cueArrival("flow"); currentView = "home"; }}
    />
  {:else if currentView === "settings" && account}
    {#if SettingsView}
      <SettingsView
        {account}
        {signedOut}
        onSignIn={handleSignInAgain}
        onBack={() => void openPane("home")}
        onOpenPane={(id) => void openPane(id)}
        onLock={handleLock}
        onLoggedOut={handleLoggedOut}
      />
    {:else}
      <div class="loading-screen"><div class="loading-spinner"></div></div>
    {/if}
  {:else if currentView === "history" && account}
    {#if HistoryView}
      <HistoryView
        {account}
        onBack={() => void openPane("home")}
        onOpenPane={(id) => void openPane(id)}
        onContinue={startCheckIn}
        onSkipDraft={handleSkipDraft}
        onDeleted={(id) => { lastSaved = forget(lastSaved, id); }}
      />
    {:else}
      <div class="loading-screen"><div class="loading-spinner"></div></div>
    {/if}
  {/if}
</div>

<style>
  /* Its height lands at once (lib/reach.ts) */
  .reach-room {
    flex: none;
    transition-property: none;
  }

  /* Grows with its pane (never shrunk to the screen as #app's flex item),
     so the sticky pane bar has the whole page to stick in */
  .app-root {
    flex: none;
    width: 100%;
    min-height: 100%;
    display: flex;
    flex-direction: column;
  }

  /* Room for the offline band (24 px, OfflineBand.svelte): every screen that
     keeps clear of the notch with --safe-top keeps clear of the band too */
  .app-root.offline {
    --safe-top: calc(env(safe-area-inset-top, 0px) + 24px);
  }

  .app-notice {
    margin: calc(1rem + var(--safe-top, 0px)) auto 0;
    max-width: 440px;
    padding: 0 1.5rem;
    color: var(--c-ink, #1c1c1a);
  }

  .damaged {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.25rem;
    max-width: 440px;
    margin: 0 auto;
    padding: 0 1.5rem;
    text-align: center;
    color: var(--c-ink, #1c1c1a);
  }

  .damaged-actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .damaged-reset {
    min-height: 48px;
    padding: 0 1.25rem;
    border: none;
    border-radius: 12px;
    background: var(--c-accent, #4f46e5);
    color: var(--c-on-accent, #ffffff);
    font: inherit;
    cursor: pointer;
  }

  /* Secondary: it opens a confirm over the screen (dotted, .text-action) */
  .damaged-other {
    min-height: 44px;
    padding: 0 0.75rem;
    border: none;
    background: none;
    color: var(--c-ink, #1c1c1a);
    font: inherit;
    text-decoration-line: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .damaged-other:focus-visible {
    outline: 3px solid var(--c-focus, #4f46e5);
    outline-offset: 2px;
  }

  .loading-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    width: 100%;
  }

  .loading-spinner {
    width: 36px;
    height: 36px;
    border: 3px solid var(--c-line, #e2e8f0);
    border-top-color: var(--c-accent, #3182ce);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
