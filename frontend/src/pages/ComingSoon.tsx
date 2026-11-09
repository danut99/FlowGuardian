import { motion } from 'motion/react'
import { fadeUp, stagger } from '../components/motion'

const CONTENT = {
  api: {
    title: 'API Guardian',
    tagline: 'Monitorizează API-urile: disponibilitate, viteză și răspunsuri corecte.',
    features: [
      ['Disponibilitate', 'Verificăm periodic fiecare endpoint și te anunțăm când nu răspunde.'],
      ['Viteză', 'Alertă când timpul de răspuns depășește pragul tău (ex. 2 secunde).'],
      ['Status HTTP', 'Detectăm erorile 4xx/5xx și schimbările neașteptate.'],
      ['Reguli pe JSON', 'Ex. products.length > 0 — un 200 cu listă goală e tot o problemă.'],
    ],
  },
  flowfix: {
    title: 'FlowFix',
    tagline: 'Când apare o problemă, FlowFix acționează automat.',
    features: [
      ['Email', 'Notificare imediată pentru incidente critice, digest zilnic pentru mentenanță.'],
      ['Tichete', 'Creează automat taskuri în instrumentul echipei tale.'],
      ['Diagnostic', 'Selector schimbat sau bug real? Îți spunem diferența.'],
      ['Acțiuni', 'Webhook-uri și alte automatizări declanșate de incidente.'],
    ],
  },
} as const

export function ComingSoon({ module }: { module: keyof typeof CONTENT }) {
  const c = CONTENT[module]
  return (
    <motion.div className="coming" variants={stagger} initial="hidden" animate="show">
      <motion.span variants={fadeUp} className="chip accent">În curând</motion.span>
      <motion.h1 variants={fadeUp} className="gradient-text" style={{ fontSize: '2.4rem', marginTop: '1rem' }}>{c.title}</motion.h1>
      <motion.p variants={fadeUp} className="muted" style={{ fontSize: '1.05rem' }}>{c.tagline}</motion.p>
      <motion.div className="feature-grid" variants={stagger}>
        {c.features.map(([title, text]) => (
          <motion.div key={title} variants={fadeUp} className="card">
            <h3>{title}</h3>
            <p className="muted" style={{ margin: 0 }}>{text}</p>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  )
}
