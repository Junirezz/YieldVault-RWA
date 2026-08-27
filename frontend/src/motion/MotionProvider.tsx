import type { ReactNode } from "react";
import { MotionConfig } from "framer-motion";

interface MotionProviderProps {
  children: ReactNode;
}

/**
 * Honors the user's reduced-motion preference for every Framer Motion animation.
 */
export default function MotionProvider({ children }: MotionProviderProps) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
