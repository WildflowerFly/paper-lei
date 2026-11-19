import type { OpenDocument } from '../types/ipc'

export type ConflictReason = 'modified' | 'missing' | 'replaced' | 'unavailable'

export type ConflictSession = {
  documentId: string
  base: string
  local: string
  disk: OpenDocument | null
  reason: ConflictReason
}

export function createConflictSession(
  documentId: string,
  base: string,
  local: string,
  disk: OpenDocument | null,
  reason: ConflictReason = disk ? 'modified' : 'missing',
): ConflictSession {
  return { documentId, base, local, disk, reason }
}

export function diskVersionChanged(
  previous: OpenDocument['diskVersion'],
  next: OpenDocument['diskVersion'],
) {
  return previous.fileId !== next.fileId || previous.hash !== next.hash
}
