// Chips for a subject's state and a student's health, in the same hues the tree uses.
import type { ComponentProps, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Select as SelectPrimitive } from 'radix-ui'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { HealthState, SubjectState } from '@/lib/types'

const SUBJECT: Record<SubjectState, string> = {
  approved: 'bg-approved text-accent-foreground',
  regular: 'bg-regular text-warning-foreground',
  enrolled: 'bg-enrolled text-foreground',
  available: 'border-border bg-card text-foreground',
  locked: 'bg-muted text-muted-foreground',
}
const HEALTH: Record<HealthState, string> = {
  lush: 'bg-approved text-accent-foreground',
  wilted: 'bg-regular text-warning-foreground',
  withered: 'bg-destructive/10 text-destructive',
}

type Props = Omit<ComponentProps<typeof Badge>, 'variant'>

export function SubjectBadge({ state, className, ...props }: Props & { state: SubjectState }) {
  return <Badge variant="outline" className={cn('border-transparent font-bold', SUBJECT[state], className)} {...props} />
}

export function HealthBadge({ state, className, ...props }: Props & { state: HealthState }) {
  return <Badge variant="outline" className={cn('border-transparent font-bold', HEALTH[state], className)} {...props} />
}

export type SubjectMarkState = 'approved' | 'regular' | 'enrolled'
const MARKS: [SubjectMarkState, string][] = [['enrolled', 'Cursando'], ['regular', 'Regular'], ['approved', 'Aprobada']]
const isMark = (s: SubjectState): s is SubjectMarkState => MARKS.some(([m]) => m === s)

// The state chip as a menu to mark the subject right there; the last option clears the mark
export function SubjectStateSelect({ state, children, onMark, onClear, disabled, className, 'aria-label': label }: { state: SubjectState; children: ReactNode;
  onMark: (s: SubjectMarkState) => void; onClear: () => void; disabled?: boolean; className?: string; 'aria-label'?: string }) {
  const marked = isMark(state)
  return (
    <Select value={marked ? state : 'none'} onValueChange={v => v === 'none' ? onClear() : onMark(v as SubjectMarkState)} disabled={disabled}>
      <SubjectBadge state={state} asChild
        className={cn('h-6 cursor-pointer gap-0.5 pr-1.5 outline-none hover:brightness-95 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50', className)}>
        <SelectPrimitive.Trigger aria-label={label}>{children}<ChevronDown className="opacity-60" /></SelectPrimitive.Trigger>
      </SubjectBadge>
      <SelectContent position="popper" align="end">
        {MARKS.map(([m, l]) => <SelectItem key={m} value={m}>{l}</SelectItem>)}
        <SelectItem value="none" disabled={!marked}>{state === 'enrolled' ? 'Ya no la curso' : 'Sin marcar'}</SelectItem>
      </SelectContent>
    </Select>
  )
}
