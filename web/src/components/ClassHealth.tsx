// How a class is doing: a bar split by the students' tree health (teacher view, §2.6).
import type { HealthCount, HealthState, TaughtSubject } from '../lib/types'

// for the teacher, the tree's health as the student's situation (same colors as the tree)
export const HEALTH_LABEL: Record<HealthState, string> = { lush: 'Activo', wilted: 'Irregular', withered: 'Inactivo' }
export const HEALTH_HINT: Record<HealthState, string> = { lush: 'Constante: practica seguido', wilted: 'En seguimiento: hace unos días que no practica', withered: 'Sin interacción: hace más de 10 días que no practica' }
const ORDER: HealthState[] = ['withered', 'wilted', 'lush']

export const termOf = (s: TaughtSubject) => s.year ? `${s.year}.º año, ${s.term}.º cuatrimestre` : 'Optativa'
export const students = (n: number) => n === 1 ? '1 alumno' : `${n} alumnos`

export default function ClassHealth({ health }: { health: HealthCount }) {
  const total = health.lush + health.wilted + health.withered
  return (
    <div className="class-health">
      <div className="health-bar" role="img" aria-label={ORDER.map(h => `${health[h]} ${HEALTH_LABEL[h].toLowerCase()}`).join(', ')}>
        {total === 0 ? <i className="none" /> : ORDER.map(h => health[h] > 0 && <i key={h} className={h} style={{ flexGrow: health[h] }} />)}
      </div>
      <div className="health-legend">
        {ORDER.map(h => <span key={h} title={HEALTH_HINT[h]}><i className={h} />{health[h]} {HEALTH_LABEL[h].toLowerCase()}</span>)}
      </div>
    </div>
  )
}
