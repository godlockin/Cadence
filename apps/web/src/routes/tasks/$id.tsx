import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/tasks/$id')({ component: TaskLayout })

function TaskLayout(): React.ReactNode {
  return <Outlet />
}
