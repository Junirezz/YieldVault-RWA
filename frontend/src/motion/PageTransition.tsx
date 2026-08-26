import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLocation } from "react-router-dom";
import { pageTransition, pageVariants, reducedPageVariants } from "./variants";

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * Cross-fades page content on route changes. Disabled when reduced motion is requested.
 */
export default function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const prefersReducedMotion = useReducedMotion();
  const variants = prefersReducedMotion ? reducedPageVariants : pageVariants;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={prefersReducedMotion ? { duration: 0 } : pageTransition}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
