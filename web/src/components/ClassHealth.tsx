// How a class is doing: a bar split by the students' tree health (teacher view, §2.6).
import type { HealthCount, HealthState, TaughtSubject } from '../lib/types'
import { cn } from '@/lib/utils'

const COLOR: Record<HealthState, string> = { lush: 'bg-lush', wilted: 'bg-wilted', withered: 'bg-withered' }

// for the teacher, the tree's health as the student's situation (same colors as the tree)
export const HEALTH_LABEL: Record<HealthState, string> = { lush: 'Activo', wilted: 'Irregular', withered: 'Inactivo' }
export const HEALTH_HINT: Record<HealthState, string> = { lush: 'Constante: practica seguido', wilted: 'En seguimiento: hace unos días que no practica', withered: 'Sin interacción: hace más de 10 días que no practica' }
const ORDER: HealthState[] = ['withered', 'wilted', 'lush']

export const termOf = (s: TaughtSubject) => s.year ? `${s.year}.º año, ${s.term}.º cuatrimestre` : 'Optativa'
export const students = (n: number) => n === 1 ? '1 alumno' : `${n} alumnos`

export default function ClassHealth({ health }: { health: HealthCount }) {
  const total = health.lush + health.wilted + health.withered
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={ORDER.map(h => `${health[h]} ${HEALTH_LABEL[h].toLowerCase()}`).join(', ')}>
        {total === 0 ? <i className="flex-1 bg-muted" /> : ORDER.map(h => health[h] > 0 && <i key={h} className={cn('min-w-2 basis-0', COLOR[h])} style={{ flexGrow: health[h] }} />)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold text-muted-foreground">
        {ORDER.map(h => <span key={h} title={HEALTH_HINT[h]} className="flex items-center gap-1.5"><i className={cn('size-2.5 rounded-full', COLOR[h])} />{health[h]} {HEALTH_LABEL[h].toLowerCase()}</span>)}
      </div>
    </div>
  )
}
