export const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
}

export const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
}
