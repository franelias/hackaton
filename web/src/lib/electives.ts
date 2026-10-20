// Which elective the student takes in each Optativa of the plan. The plan has the Optativas (I, II and III,
// obligatory: the Tesina needs them) and, apart, the electives that fill them; the backend does not pair
// them, so the browser keeps the pairing. A paired Optativa is marked along with its elective.
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { TreeChange } from './mutations'
import type { Plan, PlanSubject, SubjectState } from './types'

type Picks = Record<number, number>
const listeners = new Set<() => void>()
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const parse = (v: string | null): Picks => { try { return v ? JSON.parse(v) as Picks : {} } catch { return {} } }

export const isSlot = (s: PlanSubject) => !s.optional && /^optativa\b/i.test(s.name)
const marked = (s: SubjectState): s is 'approved' | 'regular' | 'enrolled' => s === 'approved' || s === 'regular' || s === 'enrolled'

export function useElectives(studentId: string, plan: Plan | null) {
  const key = `arbol.electives.${studentId}`
  const raw = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => read(key))
  const byId = useMemo(() => new Map((plan?.subjects ?? []).map(s => [s.subject_id, s])), [plan])
  // a pick whose subject left the plan is forgotten
  const picks = useMemo(() => Object.fromEntries(Object.entries(parse(raw)).filter(([s, e]) => byId.has(Number(s)) && byId.get(e)?.optional)) as Picks, [raw, byId])
  const pickOf = useCallback((slot: number) => byId.get(picks[slot]) ?? null, [byId, picks])

  // the electives an Optativa can take: the ones no other Optativa took
  const optionsFor = (slot: number) => (plan?.subjects ?? []).filter(s => s.optional && !Object.entries(picks).some(([o, e]) => Number(o) !== slot && e === s.subject_id))

  // a change to a paired Optativa goes to its elective too (the exam date, only to the elective; an aplazo
  // stays where it was loaded, so it is not counted twice)
  const expand = (c: TreeChange): TreeChange[] => {
    if (c.kind === 'checkin' || c.kind === 'unfail' || c.kind === 'fail' || picks[c.subjectId] == null) return [c]
    const e = picks[c.subjectId]
    return c.kind === 'exam' ? [{ ...c, subjectId: e }] : [{ ...c, subjectId: e }, c]
  }

  // pairs (or unpairs) an Optativa; it answers the changes that bring the electives to the Optativa's state
  const pick = (slot: number, elective: number | null, stateOf: (id: number) => SubjectState): TreeChange[] => {
    const old = picks[slot], st = stateOf(slot), out: TreeChange[] = []
    if (old != null && old !== elective && marked(stateOf(old))) out.push({ kind: 'unmark', subjectId: old })
    if (elective != null && marked(st) && stateOf(elective) !== st) out.push({ kind: 'mark', subjectId: elective, state: st })
    const next = { ...picks }; if (elective == null) delete next[slot]; else next[slot] = elective
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* no storage */ }
    listeners.forEach(l => l())
    return out
  }

  // the plan as the tree draws it: each paired Optativa carries its elective's name, and the elective does not
  // grow a branch of its own
  const treePlan = useMemo(() => {
    if (!plan) return null
    const taken = new Set(Object.values(picks))
    return { ...plan, subjects: plan.subjects.filter(s => !taken.has(s.subject_id)).map(s => { const e = byId.get(picks[s.subject_id]); return e ? { ...s, name: e.name } : s }) }
  }, [plan, picks, byId])

  return { pickOf, optionsFor, expand, pick, treePlan }
}
