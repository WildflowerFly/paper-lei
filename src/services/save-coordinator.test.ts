import { afterEach, describe, expect, it, vi } from 'vitest'
import { SaveCoordinator } from './save-coordinator'

describe('SaveCoordinator', () => {
  afterEach(() => vi.useRealTimers())

  it('waits 800ms after the latest edit before saving', async () => {
    vi.useFakeTimers()
    const saved: number[] = []
    const coordinator = new SaveCoordinator(() => undefined)
    const request = (revision: number) => ({
      documentId: 'doc',
      revision,
      save: async () => undefined,
      onSaved: () => saved.push(revision),
    })

    coordinator.schedule(request(1))
    await vi.advanceTimersByTimeAsync(700)
    coordinator.schedule(request(2))
    await vi.advanceTimersByTimeAsync(799)
    expect(saved).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(saved).toEqual([2])
    coordinator.dispose()
  })

  it('serializes writes and saves the latest queued revision', async () => {
    vi.useFakeTimers()
    const resolveFirst = vi.fn<() => void>()
    const saved: number[] = []
    const coordinator = new SaveCoordinator(() => undefined, 1)
    const first = new Promise<void>((resolve) => resolveFirst.mockImplementation(resolve))
    coordinator.schedule({
      documentId: 'doc',
      revision: 1,
      save: () => first,
      onSaved: () => saved.push(1),
    })
    await vi.advanceTimersByTimeAsync(1)
    coordinator.schedule({
      documentId: 'doc',
      revision: 2,
      save: async () => undefined,
      onSaved: () => saved.push(2),
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(saved).toEqual([])
    resolveFirst()
    await vi.runAllTimersAsync()
    expect(saved).toEqual([1, 2])
    coordinator.dispose()
  })

  it('pauses automatic retries after a conflict but allows manual retry', async () => {
    const statuses: string[] = []
    const coordinator = new SaveCoordinator((_id, status) => statuses.push(status), 1)
    const conflict = Object.assign(new Error('changed'), { code: 'CONFLICT' })
    const request = {
      documentId: 'doc',
      revision: 1,
      save: vi.fn().mockRejectedValueOnce(conflict).mockResolvedValue(undefined),
      onSaved: vi.fn(),
    }

    await coordinator.saveNow(request)
    expect(coordinator.status('doc')).toBe('conflict')
    coordinator.schedule(request)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(request.save).toHaveBeenCalledTimes(1)
    await coordinator.saveNow({ ...request, revision: 2 })
    expect(request.save).toHaveBeenCalledTimes(2)
    expect(statuses).toContain('conflict')
    coordinator.dispose()
  })

  it('drops pending writes when a conflict session pauses a document', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue(undefined)
    const coordinator = new SaveCoordinator(() => undefined, 10)
    coordinator.schedule({ documentId: 'doc', revision: 1, save, onSaved: vi.fn() })
    coordinator.pause('doc')
    await vi.advanceTimersByTimeAsync(20)
    expect(save).not.toHaveBeenCalled()
    expect(coordinator.status('doc')).toBe('conflict')
    coordinator.schedule({ documentId: 'doc', revision: 2, save, onSaved: vi.fn() })
    await vi.advanceTimersByTimeAsync(20)
    expect(save).not.toHaveBeenCalled()
    coordinator.dispose()
  })
})
