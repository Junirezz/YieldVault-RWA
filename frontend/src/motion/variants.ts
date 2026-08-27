import type { Transition, Variants } from "framer-motion";

export const pageTransition: Transition = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1],
};

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export const reducedPageVariants: Variants = {
  initial: { opacity: 1, y: 0 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 1, y: 0 },
};

export const buttonHover = { scale: 1.02, y: -1 };
export const buttonTap = { scale: 0.97 };

export const formFieldFocus = { scale: 1.005 };

export const skeletonPulse: Variants = {
  animate: {
    opacity: [0.55, 1, 0.55],
    transition: {
      duration: 1.4,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
};
