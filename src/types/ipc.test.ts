import { describe, expect, it, vi } from 'vitest'
import { createFileIpc, type AuthorizationToken, type TextMetadata } from './ipc'

describe('file IPC contract', () => {
  it('accepts only a token and relative operation path', async () => {
    const invoke = vi.fn().mockResolvedValue({
      name: '我的 文件.md',
      isDirectory: false,
      identity: { volume: 1, index: '0000000000000002' },
    })
    const ipc = createFileIpc(invoke)
    const token = 'a3fe5ac0-2433-4ed9-8ab7-e0e14ebcc326' as AuthorizationToken

    await expect(ipc.inspectAuthorizedEntry(token, 'notes/我的 文件.md')).resolves.toMatchObject({
      name: '我的 文件.md',
    })
    expect(invoke).toHaveBeenCalledWith('inspect_authorized_entry', {
      token,
      relativePath: 'notes/我的 文件.md',
    })
  })

  it('keeps document opening behind typed token commands', async () => {
    const invoke = vi.fn().mockResolvedValue([])
    const ipc = createFileIpc(invoke)
    const token = 'a3fe5ac0-2433-4ed9-8ab7-e0e14ebcc326' as AuthorizationToken

    await ipc.chooseAndOpenDocuments()
    expect(invoke).toHaveBeenCalledWith('choose_and_open_documents')
    await ipc.openDocument('a3fe5ac0-2433-4ed9-8ab7-e0e14ebcc326' as AuthorizationToken)
    expect(invoke).toHaveBeenCalledWith('open_document', {
      token: 'a3fe5ac0-2433-4ed9-8ab7-e0e14ebcc326',
    })
    const metadata: TextMetadata = { bom: false, lineEndings: ['lf'], trailingNewline: true }
    const diskVersion = { fileId: '1:2', hash: 'hash', length: 1, modified: 1 }
    await ipc.saveDocument(token, 'x', metadata, 3, diskVersion)
    expect(invoke).toHaveBeenCalledWith('save_document', {
      token,
      text: 'x',
      metadata,
      revision: 3,
      expectedDiskVersion: diskVersion,
    })
    await ipc.saveDocumentAs('x', metadata, 3)
    expect(invoke).toHaveBeenCalledWith('save_document_as', {
      text: 'x',
      metadata,
      revision: 3,
    })
  })
})
