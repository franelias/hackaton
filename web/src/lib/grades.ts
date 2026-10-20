// The student's record (libreta): averages by year and overall, with and without aplazos, how much of the
// career is done and what the average could still become. Pure: it takes the plan as the tree draws it (each
// Optativa standing for its elective) and the tree.
import type { Plan, PlanSubject, Tree } from './types'

export interface YearRecord { year: number; subjects: PlanSubject[]; approved: number; average: number | null }

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null

export function summarize(plan: Plan, tree: Tree) {
  const by = new Map(tree.subjects.map(s => [s.subject_id, s]))
  const gradeOf = (id: number) => by.get(id)?.state === 'approved' ? by.get(id)?.grade ?? null : null
  // the electives not taken are not part of the career; the Optativas are
  const career = plan.subjects.filter(s => !s.optional)
  const approved = career.filter(s => by.get(s.subject_id)?.state === 'approved')
  const grades = approved.map(s => gradeOf(s.subject_id)).filter((g): g is number => g != null)
  const fails = tree.subjects.flatMap(s => (s.fails ?? []).map(f => ({ ...f, subject_id: s.subject_id })))
  const remaining = career.length - approved.length
  // the average if every remaining final got this grade, optionally counting the aplazos
  const ifAll = (g: number, withFails = false) =>
    mean([...grades, ...(withFails ? fails.map(f => f.grade) : []), ...Array<number>(remaining).fill(g)])

  const years: YearRecord[] = [...career.reduce((m, s) => m.set(s.year ?? 0, [...(m.get(s.year ?? 0) ?? []), s]), new Map<number, PlanSubject[]>())]
    .sort(([a], [b]) => (a || 99) - (b || 99))
    .map(([year, subjects]) => ({
      year,
      subjects: subjects.sort((a, b) => (a.term ?? 0) - (b.term ?? 0) || a.name.localeCompare(b.name)),
      approved: subjects.filter(s => by.get(s.subject_id)?.state === 'approved').length,
      average: mean(subjects.map(s => gradeOf(s.subject_id)).filter((g): g is number => g != null)),
    }))

  return {
    years, fails, remaining,
    total: career.length,
    approved: approved.length,
    // approved subjects whose grade is not loaded yet: they do not count in the averages
    ungraded: approved.length - grades.length,
    average: mean(grades),
    withFails: mean([...grades, ...fails.map(f => f.grade)]),
    done: career.length ? approved.length / career.length : 0,
    ifAll,
  }
}

export const validGrade = (g: number) => Number.isInteger(g) && g >= 1 && g <= 10

export const formatGrade = (g: number | null) => g == null ? '—' : g.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export type Summary = ReturnType<typeof summarize>
