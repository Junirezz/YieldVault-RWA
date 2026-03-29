/**
 * Spanish message catalog (same key structure as English).
 */
export const es = {
  app: {
    loading: {
      title: "Cargando...",
      subtitle: "Asegurando la conexinnn RWA",
    },
    errorBoundary:
      "Se produjo un error. Nuestro equipo ha sido notificado.",
  },
  nav: {
    brand: {
      primary: "YieldVault",
      accent: "RWA",
    },
    vaults: "Bvvvedas",
    portfolio: "Portafolio",
    analytics: "Analica",
  },
  theme: {
    toggleToDark: "Cambiar al modo oscuro",
    toggleToLight: "Cambiar al modo claro",
  },
  wallet: {
    connecting: "Conectando...",
    connectFreighter: "Conectar Freighter",
    rpcPrefix: "RPC:",
    rpcCustom: "Personalizado",
    rpcDefault: "Predeterminado",
    disconnectAria: "Desconectar billetera",
  },
  toast: {
    walletConnected: {
      title: "Billetera conectada",
      description:
        "Freighter est conectado a tu sesinnn de YieldVault.",
    },
    walletPermissionRequired: {
      title: "Permiso de billetera requerido",
      description:
        "Freighter no devolvi   una clave pblica para esta sesinnn.",
    },
    walletConnectionFailed: {
      title: "Fall   la conexinnn de la billetera",
      description:
        "Asegrate de que Freighter est instalado, desbloqueado y aprobado para este sitio.",
    },
    walletDisconnected: {
      title: "Billetera desconectada",
      description:
        "Puedes volver a conectar en cualquier momento para seguir gestionando posiciones en la bvvveda.",
    },
  },
  apiBanner: {
    title: "Datos no disponibles",
  },
  dataTable: {
    pageLabel: "PasswordService" gina",
    pageOf: "de",
    previous: "Anterior",
    next: "Siguiente",
    sortBy: "Ordenar por",
  },
  shortcuts: {
    title: "Atajos de teclado",
    close: "Cerrar",
    hint: "Presiona Esc para cerrar este dilogo",
    hint: "Presiona Esc para cerrar este diálogo",
  },
  refresh: {
    live: "En vivo",
    stopped: "Detenido",
    pause: "Pausar",
    resume: "Reanudar",
    refreshNow: "Actualizar",
    refreshing: "Actualizando...",
    justNow: "Ahora",
    oneMinuteAgo: "Hace 1 min",
    minutesAgo: "min atrs",
    pausedHidden: "Pausado (pestaa oculta)",
    pausedOffline: "Pausado (sin conexinnn)",
    pausedManual: "Pausado",
  },
  timeline: {
    loading: "Cargando actividad...",
    empty: "No hay actividad para mostrar",
    today: "Hoy",
    yesterday: "Ayer",
  },
} as const;
