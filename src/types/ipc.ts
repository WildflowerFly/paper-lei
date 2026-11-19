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
  | 'SAVE_FAILED'

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
  diskVersion: DiskVersion
}

export interface DiskVersion {
  fileId: string
  hash: string
  length: number
  modified: number
}

export interface SaveDocumentRequest {
  token: AuthorizationToken
  text: string
  metadata: TextMetadata
  revision: number
  expectedDiskVersion: DiskVersion
}

export interface SaveResult {
  revision: number
  identity: FileIdentity
  diskVersion: DiskVersion
}

export type DocumentChangedEvent = { token: AuthorizationToken }

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
    readLatestDocument(token: AuthorizationToken): Promise<OpenDocument> {
      return invoke<OpenDocument>('read_latest_document', { token })
    },
    adoptDocumentVersion(token: AuthorizationToken, expectedDiskVersion: DiskVersion) {
      return invoke<OpenDocument>('adopt_document_version', { token, expectedDiskVersion })
    },
    watchDocument(token: AuthorizationToken): Promise<void> {
      return invoke<void>('watch_document', { token })
    },
    unwatchDocument(token: AuthorizationToken): Promise<void> {
      return invoke<void>('unwatch_document', { token })
    },
    saveDocument(
      token: AuthorizationToken,
      text: string,
      metadata: TextMetadata,
      revision: number,
      expectedDiskVersion: DiskVersion,
    ): Promise<SaveResult> {
      return invoke<SaveResult>('save_document', {
        token,
        text,
        metadata,
        revision,
        expectedDiskVersion,
      })
    },
    saveDocumentAs(
      text: string,
      metadata: TextMetadata,
      revision: number,
    ): Promise<OpenDocument | null> {
      return invoke<OpenDocument | null>('save_document_as', { text, metadata, revision })
    },
  }
}
