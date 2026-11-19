import { describe, expect, it, vi } from 'vitest'
import { createFileIpc, type AuthorizationToken } from './ipc'

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

    await ipc.chooseAndOpenDocuments()
    expect(invoke).toHaveBeenCalledWith('choose_and_open_documents')
    await ipc.openDocument('a3fe5ac0-2433-4ed9-8ab7-e0e14ebcc326' as AuthorizationToken)
    expect(invoke).toHaveBeenCalledWith('open_document', {
      token: 'a3fe5ac0-2433-4ed9-8ab7-e0e14ebcc326',
    })
  })
})
