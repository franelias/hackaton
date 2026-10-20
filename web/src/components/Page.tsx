// Page layout pieces shared by every screen: the header, and the loading and error states.
import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function Page({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8', className)}>{children}</div>
}

export function PageHeader({ title, description, children }: { title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="text-3xl leading-tight font-extrabold tracking-tight text-balance md:text-4xl">{title}</h1>
        {description && <p className="max-w-[65ch] text-base text-pretty text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-3">{children}</div>}
    </header>
  )
}

// a skeleton with the shape of a page: header and two blocks
export function PageLoading({ label }: { label: string }) {
  return (
    <Page>
      <div role="status" aria-label={label} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2"><Skeleton className="h-9 w-72 max-w-full" /><Skeleton className="h-5 w-[28rem] max-w-full" /></div>
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    </Page>
  )
}

export function PageError({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="grid min-h-[60dvh] place-items-center px-4">
      <div role="alert" className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive"><CircleAlert /></span>
        <p className="font-semibold text-pretty">{message}</p>
        {action ?? <Button variant="outline" onClick={() => location.reload()}>Reintentar</Button>}
      </div>
    </div>
  )
}

// small inline message under a form or a block
export function InlineError({ children }: { children: ReactNode }) {
  return <p role="alert" className="text-sm font-semibold text-destructive">{children}</p>
}
