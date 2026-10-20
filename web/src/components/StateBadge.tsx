// Chips for a subject's state and a student's health, in the same hues the tree uses.
import type { ComponentProps } from 'react'
import { Badge } from '@/components/ui/badge'
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
