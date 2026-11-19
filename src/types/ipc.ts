export type AuthorizationToken = string & { readonly __authorizationToken: unique symbol }

export type IpcErrorCode =
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'PATH_OUT_OF_SCOPE'
  | 'INVALID_NAME'
  | 'ALREADY_EXISTS'
  | 'UNSUPPORTED_ENCODING'
  | 'READ_ONLY'
  | 'DISK_FULL'
  | 'FILE_BUSY'
  | 'CONFLICT'
  | 'CONFLICT_DURING_COMMIT'
  | 'RESOURCE_BLOCKED'
  | 'RENDER_TIMEOUT'
  | 'EXPORT_FAILED'
  | 'CANCELLED'
  | 'INVALID_TOKEN'

export interface IpcError {
  code: IpcErrorCode
  message: string
  retryable: boolean
  operationId: string | null
  details: unknown | null
}

export interface FileIdentity {
  volume: number
  index: string
}

export interface EntryInspection {
  name: string
  isDirectory: boolean
  identity: FileIdentity
}

export type LineEnding = 'lf' | 'cr_lf' | 'cr'

export interface TextMetadata {
  bom: boolean
  lineEndings: LineEnding[]
  trailingNewline: boolean
}

export interface OpenDocument {
  token: AuthorizationToken
  name: string
  displayPath: string
  identity: FileIdentity
  text: string
  metadata: TextMetadata
  readOnly: boolean
}

export type TauriInvoke = <Result>(
  command: string,
  arguments_?: Record<string, unknown>,
) => Promise<Result>

export function createFileIpc(invoke: TauriInvoke) {
  return {
    inspectAuthorizedEntry(
      token: AuthorizationToken,
      relativePath: string,
    ): Promise<EntryInspection> {
      return invoke<EntryInspection>('inspect_authorized_entry', { token, relativePath })
    },
    chooseAndOpenDocuments(): Promise<OpenDocument[]> {
      return invoke<OpenDocument[]>('choose_and_open_documents')
    },
    openDocument(token: AuthorizationToken): Promise<OpenDocument> {
      return invoke<OpenDocument>('open_document', { token })
    },
  }
}
