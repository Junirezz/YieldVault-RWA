/**
 * English (primary) message catalog.
 */
export const en = {
  app: {
    loading: {
      title: "Loading...",
      subtitle: "Securing RWA connection",
    },
    errorBoundary:
      "An error occurred. Our team has been notified.",
  },
  nav: {
    brand: {
      primary: "YieldVault",
      accent: "RWA",
    },
    vaults: "Vaults",
    portfolio: "Portfolio",
    analytics: "Analytics",
  },
  theme: {
    toggleToDark: "Toggle to dark mode",
    toggleToLight: "Toggle to light mode",
  },
  wallet: {
    connecting: "Connecting...",
    connectFreighter: "Connect Freighter",
    rpcPrefix: "RPC:",
    rpcCustom: "Custom",
    rpcDefault: "Default",
    disconnectAria: "Disconnect Wallet",
  },
  toast: {
    walletConnected: {
      title: "Wallet connected",
      description:
        "Freighter is now connected to your YieldVault session.",
    },
    walletPermissionRequired: {
      title: "Wallet permission required",
      description:
        "Freighter did not return a public key for this session.",
    },
    walletConnectionFailed: {
      title: "Wallet connection failed",
      description:
        "Ensure Freighter is installed, unlocked, and approved for this site.",
    },
    walletDisconnected: {
      title: "Wallet disconnected",
      description:
        "You can reconnect any time to continue managing vault positions.",
    },
  },
  apiBanner: {
    title: "Data unavailable",
  },
  dataTable: {
    pageLabel: "Page",
    pageOf: "of",
    previous: "Previous",
    next: "Next",
    sortBy: "Sort by",
  },
  shortcuts: {
    title: "Keyboard Shortcuts",
    close: "Close",
    hint: "Press Esc to close this dialog",
  },
  refresh: {
    live: "Live",
    stopped: "Stopped",
    pause: "Pause",
    resume: "Resume",
    refreshNow: "Refresh",
    refreshing: "Refreshing...",
    justNow: "Just now",
    oneMinuteAgo: "1 min ago",
    minutesAgo: "min ago",
    pausedHidden: "Paused (tab hidden)",
    pausedOffline: "Paused (offline)",
    pausedManual: "Paused",
  },
  timeline: {
    loading: "Loading activity...",
    empty: "No activity to display",
    today: "Today",
    yesterday: "Yesterday",
  },
} as const;
