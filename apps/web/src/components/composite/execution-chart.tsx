import type { ReactNode } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Execution } from '@/lib/types'

interface ChartPoint {
  time: string
  success: number
  failed: number
}

/** Aggregate executions into a success/failure area chart over time. */
export function ExecutionChart({ executions }: { executions: Execution[] }): ReactNode {
  const points: ChartPoint[] = executions
    .filter((e) => e.startedAt !== null)
    .map((e) => ({
      time: new Date(e.startedAt as number).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }),
      success: e.status === 'success' ? 1 : 0,
      failed: e.status === 'failed' ? 1 : 0,
    }))

  if (points.length === 0) {
    return <div className="py-12 text-center text-sm text-muted-foreground">No data</div>
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
          <defs>
            <linearGradient id="ok" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="err" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} />
          <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              fontSize: 12,
            }}
          />
          <Area
            type="monotone"
            dataKey="success"
            name="Success"
            stroke="#3b82f6"
            fill="url(#ok)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="failed"
            name="Failed"
            stroke="#ef4444"
            fill="url(#err)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
