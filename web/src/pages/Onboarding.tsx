import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Navigate, useNavigate } from 'react-router-dom'
import { api, type SubjectMark } from '../lib/api'
import { facultiesQuery, planQuery, queryClient } from '../lib/queries'
import { useSession } from '../lib/session'
import type { Faculty, PlanSubject } from '../lib/types'
import Logo from '@/components/Logo'
import { InlineError, PageLoading } from '@/components/Page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

type Mark = 'approved' | 'regular' | 'enrolled' | ''
// Radix toggle groups have no empty value: "none" stands for "Todavía no"
const OPTIONS: [Mark, string][] = [['', 'Todavía no'], ['enrolled', 'La curso'], ['regular', 'Regular'], ['approved', 'Aprobada']]

// Step 1: name, faculty and career. Step 2: mark what you have already done (nothing, if you are new).
export default function Onboarding() {
  const { user, studentId, setStudentId, refresh, loading } = useSession()
  const nav = useNavigate()
  const [step, setStep] = useState(1)
  const [name, setName] = useState(user?.displayName ?? '')
  const [facultyId, setFacultyId] = useState(''), [careerId, setCareerId] = useState<number | null>(null)
  const [marks, setMarks] = useState<Record<number, Mark>>({})
  const [id, setId] = useState<string | null>(null)
  const { data: faculties, error: facultiesError } = useQuery(facultiesQuery)
  const plan = useQuery({ ...planQuery(careerId ?? 0), enabled: step === 2 && careerId != null }).data
  // with a single option, it is picked already
  useEffect(() => { const f = faculties?.length === 1 ? faculties[0] : null; if (!f) return
    setFacultyId(f.faculty_id); setCareerId(f.careers.length === 1 ? f.careers[0].career_id : null) }, [faculties])
  // if the student was created and the plan failed, retrying does not create it again
  const create = useMutation({
    mutationFn: async () => { const sid = id ?? (await api.createStudent(name.trim(), facultyId, careerId!)).student_id; setId(sid)
      await queryClient.ensureQueryData(planQuery(careerId!)) },
    onSuccess: () => setStep(2),
  })
  // all marks in a single request
  const finish = useMutation({
    mutationFn: async () => { const subjects = Object.entries(marks).flatMap(([sid, state]): SubjectMark[] => state ? [{ subject_id: Number(sid), state }] : [])
      if (subjects.length) await api.setSubjects(id!, subjects)
      setStudentId(id!); await refresh() },
    onSuccess: () => nav('/', { replace: true }),
  })
  const sending = create.isPending || finish.isPending
  const error = facultiesError ? `No pudimos cargar las facultades: ${facultiesError.message}` : (create.error ?? finish.error)?.message
  const pickFaculty = (f?: Faculty) => { setFacultyId(f?.faculty_id ?? ''); setCareerId(f?.careers.length === 1 ? f.careers[0].career_id : null) }
  const careers = faculties?.find(f => f.faculty_id === facultyId)?.careers ?? []
  const byYear = useMemo(() => { const m = new Map<number, PlanSubject[]>()
    for (const s of plan?.subjects ?? []) if (!s.optional && s.year) m.set(s.year, [...(m.get(s.year) ?? []), s]); return [...m.entries()].sort((a, b) => a[0] - b[0]) }, [plan])

  if (loading) return <PageLoading label="Cargando" />
  if (!user) return <Navigate to="/login" replace />
  if (studentId && step === 1) return <Navigate to="/" replace />

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-2 text-xl font-extrabold"><Logo size={26} />Mamo</span>
        <span className="text-sm font-bold text-muted-foreground">Paso {step} de 2</span>
      </div>
      <Progress value={step * 50} aria-label={`Paso ${step} de 2`} className="h-1.5" />

      {step === 1 ? (
        <Card className="max-w-lg gap-6 rounded-2xl py-7">
          <CardHeader className="px-7">
            <CardTitle className="text-2xl font-extrabold md:text-3xl">Plantemos tu árbol</CardTitle>
            <CardDescription className="text-base">Vas a ver tu carrera como un árbol: cada materia es una rama que nace de sus correlativas.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 px-7">
            <div className="flex flex-col gap-2"><Label htmlFor="name">¿Cómo te llamás?</Label><Input id="name" value={name} onChange={e => setName(e.target.value)} autoFocus autoComplete="name" /></div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="faculty">Facultad</Label>
              <Select value={facultyId} disabled={!faculties || id != null} onValueChange={v => pickFaculty(faculties?.find(f => f.faculty_id === v))}>
                <SelectTrigger id="faculty" className="w-full"><SelectValue placeholder={faculties ? 'Elegí tu facultad' : 'Cargando…'} /></SelectTrigger>
                <SelectContent>{faculties?.map(f => <SelectItem key={f.faculty_id} value={f.faculty_id}>{f.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="career">Carrera</Label>
              <Select value={careerId == null ? '' : String(careerId)} disabled={!facultyId || id != null} onValueChange={v => setCareerId(Number(v))}>
                <SelectTrigger id="career" className="w-full"><SelectValue placeholder={facultyId ? 'Elegí tu carrera' : 'Primero elegí la facultad'} /></SelectTrigger>
                <SelectContent>{careers.map(c => <SelectItem key={c.career_id} value={String(c.career_id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {error && <InlineError>{error}</InlineError>}
            <Button size="lg" className="self-start" disabled={!name.trim() || careerId == null || sending} onClick={() => create.mutate()}>{sending ? 'Creando…' : 'Seguir'}</Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-6 rounded-2xl py-7">
          <CardHeader className="px-7">
            <CardTitle className="text-2xl font-extrabold md:text-3xl">¿Qué ya hiciste?</CardTitle>
            <CardDescription className="max-w-[65ch] text-base">Marcá las materias que ya aprobaste, las que tenés regulares (te falta el final) y las que estás cursando. Si recién empezás, tocá Listo.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-8 px-7">
            {byYear.map(([year, subs]) => (
              <fieldset key={year} className="flex flex-col gap-1">
                <legend className="mb-2 text-lg font-extrabold">{year}.º año</legend>
                {subs.map(s => (
                  <div className="flex flex-col gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between" key={s.subject_id}>
                    <span className="font-semibold">{s.name}</span>
                    <ToggleGroup type="single" variant="outline" size="sm" spacing={1} aria-label={s.name}
                      value={marks[s.subject_id] || 'none'} onValueChange={v => { if (v) setMarks({ ...marks, [s.subject_id]: v === 'none' ? '' : v as Mark }) }}>
                      {OPTIONS.map(([v, t]) => <ToggleGroupItem key={v || 'none'} value={v || 'none'}>{t}</ToggleGroupItem>)}
                    </ToggleGroup>
                  </div>))}
              </fieldset>))}
            {error && <InlineError>{error}</InlineError>}
            <div className="sticky bottom-4 flex justify-end">
              <Button size="lg" className="shadow-lg shadow-primary/20" disabled={sending} onClick={() => { if (id) finish.mutate() }}>{sending ? 'Guardando…' : 'Listo, ver mi árbol'}</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
