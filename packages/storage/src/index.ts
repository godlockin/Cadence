/**
 * @pulsedeck/storage — StorageAdapter contract.
 * Two implementations: D1Adapter (Cloudflare) + SQLiteAdapter (Node.js).
 * PHASE 0: interface only.
 */
import type { Credential, PipelineDefinition, PipelineRun, Schedule, User } from '@pulsedeck/domain'

export interface StorageAdapter {
  /* users */
  users: {
    findById(id: string): Promise<User | null>
    findByEmail(email: string): Promise<User | null>
    insert(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>
    update(id: string, patch: Partial<User>): Promise<User>
  }
  /* pipelines */
  pipelines: {
    listByOwner(ownerId: string): Promise<PipelineDefinition[]>
    findById(id: string): Promise<PipelineDefinition | null>
    insert(p: PipelineDefinition): Promise<PipelineDefinition>
    update(id: string, patch: Partial<PipelineDefinition>): Promise<PipelineDefinition>
    delete(id: string): Promise<void>
  }
  /* schedules */
  schedules: {
    listByPipeline(pipelineId: string): Promise<Schedule[]>
    findActiveDueAt(now: Date): Promise<Schedule[]>
    upsert(s: Schedule): Promise<Schedule>
    delete(id: string): Promise<void>
  }
  /* credentials */
  credentials: {
    listByOwner(ownerId: string): Promise<Credential[]>
    insert(c: Credential): Promise<Credential>
    delete(id: string): Promise<void>
  }
  /* runs */
  runs: {
    insert(r: PipelineRun): Promise<PipelineRun>
    update(id: string, patch: Partial<PipelineRun>): Promise<PipelineRun>
    listByPipeline(pipelineId: string, limit: number): Promise<PipelineRun[]>
  }
  /** opens underlying handle; must be awaited before any operation. */
  init(): Promise<void>
  /** graceful close. */
  close(): Promise<void>
}

export type StorageFactory = (config: unknown) => Promise<StorageAdapter>

export const VERSION = '0.1.0'

// re-export types downstream PHASE 1+ implementations need
export type { Credential, PipelineDefinition, PipelineRun, Schedule, User }
