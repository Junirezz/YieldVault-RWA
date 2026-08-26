import { useEffect, useState } from "react";
import {
  getSystemTheme,
  subscribeToSystemTheme,
  type ResolvedTheme,
} from "../lib/theme";

/** Live OS color-scheme preference (prefers-color-scheme). */
export function usePrefersColorScheme(): ResolvedTheme {
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  useEffect(() => subscribeToSystemTheme(setSystemTheme), []);

  return systemTheme;
}
