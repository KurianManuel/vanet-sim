import { useState, useCallback } from 'react'
import type { RunRecord, ComparisonStore } from '../types/comparison'

const MAX_RUNS = 5

const RUN_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a78bfa', '#ef4444']

export function useComparison(): ComparisonStore {
  const [runs, setRuns] = useState<RunRecord[]>([])

  const addRun = useCallback((run: Omit<RunRecord, 'id' | 'label' | 'completedAt'>) => {
    setRuns(prev => {
      const trimmed = prev.length >= MAX_RUNS ? prev.slice(1) : prev
      const id = Date.now()
      const runNum = trimmed.length + 1
      return [...trimmed, {
        ...run,
        id,
        label: `Run ${runNum}`,
        completedAt: id,
      }]
    })
  }, [])

  const removeRun = useCallback((id: number) => {
    setRuns(prev => prev.filter(r => r.id !== id))
  }, [])

  const clearAll = useCallback(() => setRuns([]), [])

  return { runs, addRun, removeRun, clearAll }
}

export { RUN_COLORS }
