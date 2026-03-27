/**
 * Spanish message catalog (same key structure as English).
 */
export const es = {
  app: {
    loading: {
      title: "Cargando...",
      subtitle: "Asegurando la conexión RWA",
    },
    errorBoundary:
      "Se produjo un error. Nuestro equipo ha sido notificado.",
  },
  nav: {
    brand: {
      primary: "YieldVault",
      accent: "RWA",
    },
    vaults: "Bóvedas",
    portfolio: "Portafolio",
    analytics: "Analítica",
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
        "Freighter está conectado a tu sesión de YieldVault.",
    },
    walletPermissionRequired: {
      title: "Permiso de billetera requerido",
      description:
        "Freighter no devolvió una clave pública para esta sesión.",
    },
    walletConnectionFailed: {
      title: "Falló la conexión de la billetera",
      description:
        "Asegúrate de que Freighter esté instalado, desbloqueado y aprobado para este sitio.",
    },
    walletDisconnected: {
      title: "Billetera desconectada",
      description:
        "Puedes volver a conectar en cualquier momento para seguir gestionando posiciones en la bóveda.",
    },
  },
  apiBanner: {
    title: "Datos no disponibles",
  },
  dataTable: {
    pageLabel: "Página",
    pageOf: "de",
    previous: "Anterior",
    next: "Siguiente",
    sortBy: "Ordenar por",
  },
} as const;
