// A final's grade, 1 to 10: saved on Enter or when the field loses focus; anything else goes back.
import { useState, type ComponentProps } from 'react'
import { Input } from '@/components/ui/input'
import { validGrade } from '@/lib/grades'
import { cn } from '@/lib/utils'

export default function GradeInput({ value, onSave, className, ...props }: Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & { value: number | null; onSave: (g: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft == null) return
    const g = Number(draft)
    setDraft(null)
    if (draft.trim() && validGrade(g) && g !== value) onSave(g)
  }
  return <Input type="number" inputMode="numeric" min={1} max={10} step={1} placeholder="—" value={draft ?? value ?? ''}
    onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } else if (e.key === 'Escape') setDraft(null) }}
    className={cn('h-8 w-16 text-center tabular-nums', className)} {...props} />
}
