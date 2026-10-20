import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { BookOpen, GraduationCap, MessagesSquare, CalendarDays, NotebookPen, Sprout } from 'lucide-react'
import { MOCK } from './lib/config'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { queryClient } from './lib/queries'
import { SessionProvider, useSession } from './lib/session'
import Logo from '@/components/Logo'
import { PageError, PageLoading } from '@/components/Page'
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import MyTree from './pages/MyTree'
import Tutor from './pages/Tutor'
import Schedule from './pages/Schedule'
import Subjects from './pages/Subjects'
import Grades from './pages/Grades'
import Account from './pages/Account'
import TeacherHome from './pages/TeacherHome'
import TeacherSubject from './pages/TeacherSubject'

function Avatar() {
  const { user } = useSession()
  return <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#edd3b8] font-extrabold text-[#5a3b22]" aria-hidden="true">
    {(user?.displayName ?? user?.email ?? '?').slice(0, 1).toUpperCase()}</span>
}

function AppSidebar() {
  const { user, plan, studentId, teacherId } = useSession()
  const { pathname } = useLocation()
  const { setOpenMobile } = useSidebar()
  // on the phone the menu is a sheet: close it after navigating
  useEffect(() => { setOpenMobile(false) }, [pathname, setOpenMobile])
  const items = [
    ...(studentId ? [{ to: '/', label: 'Mi árbol', icon: Sprout, end: true }, { to: '/subjects', label: 'Materias', icon: BookOpen }, { to: '/grades', label: 'Notas', icon: NotebookPen }, { to: '/tutor', label: 'Tutor', icon: MessagesSquare }, { to: '/schedule', label: 'Horarios', icon: CalendarDays }] : []),
    ...(teacherId ? [{ to: '/teacher', label: 'Mis cursos', icon: GraduationCap }] : []),
  ]
  const active = (to: string, end?: boolean) => end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`)
  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-4 px-4 pt-6">
        <div className="flex items-center gap-2.5 text-2xl font-extrabold"><Logo />Árbol</div>
        {plan && <div className="rounded-xl bg-muted px-3 py-2.5 text-[0.8rem] leading-snug font-bold">
          {plan.name}<span className="mt-0.5 block font-semibold text-muted-foreground">FCEIA, UNR</span></div>}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="px-3">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {items.map(({ to, label, icon: Icon, end }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton asChild isActive={active(to, end)}>
                    <NavLink to={to} end={end}><Icon />{label}</NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" isActive={active('/account')} className="px-2">
              <NavLink to="/account" aria-label="Mi cuenta">
                <Avatar />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate font-bold">{user?.displayName ?? user?.email}</span>
                  <span className="truncate text-xs font-semibold text-muted-foreground">{MOCK ? 'Modo demo' : 'Mi cuenta'}</span>
                </span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

function Shell() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        {/* phone: a top bar with the menu, the brand and the account */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur md:hidden print:hidden">
          <SidebarTrigger className="size-9" />
          <span className="mr-auto flex items-center gap-2 text-lg font-extrabold"><Logo size={22} />Árbol</span>
          <NavLink to="/account" aria-label="Mi cuenta" className="rounded-full"><Avatar /></NavLink>
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}

function Guard() {
  const { loading, user, studentId, teacherId, error } = useSession()
  if (loading) return <PageLoading label="Cargando tu árbol" />
  if (!user) return <Navigate to="/login" replace />
  if (!studentId && !teacherId) return error ? <PageError message={error} /> : <Navigate to="/start" replace />
  return <Shell />
}

// a teacher who is not a student goes to their classes, and vice versa
function StudentOnly() { return useSession().studentId ? <Outlet /> : <Navigate to="/teacher" replace /> }
function TeacherOnly() { return useSession().teacherId ? <Outlet /> : <Navigate to="/" replace /> }

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <TooltipProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/start" element={<Onboarding />} />
              <Route element={<Guard />}>
                <Route element={<StudentOnly />}>
                  <Route index element={<MyTree />} />
                  <Route path="subjects/:subjectId?" element={<Subjects />} />
                  <Route path="grades" element={<Grades />} />
                  <Route path="tutor" element={<Tutor />} />
                  <Route path="schedule" element={<Schedule />} />
                </Route>
                <Route element={<TeacherOnly />}>
                  <Route path="teacher" element={<TeacherHome />} />
                  <Route path="teacher/subjects/:subjectId" element={<TeacherSubject />} />
                </Route>
                <Route path="account" element={<Account />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
          <Toaster position="bottom-right" richColors={false} />
        </TooltipProvider>
      </SessionProvider>
      {/* only in development: the production build exports nothing */}
      <ReactQueryDevtools buttonPosition="bottom-right" />
    </QueryClientProvider>
  )
}
