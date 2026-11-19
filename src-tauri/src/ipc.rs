use markdown_studio::prototypes::authorization::{
    AuthorizationRegistry, AuthorizationToken, DiskVersion, EntryInspection, IpcError,
    OpenDocument, SaveResult, TextMetadata,
};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn inspect_authorized_entry(
    window: WebviewWindow,
    registry: State<'_, std::sync::Mutex<AuthorizationRegistry>>,
    token: AuthorizationToken,
    relative_path: String,
) -> Result<EntryInspection, IpcError> {
    if window.label() != "main" {
        return Err(window_error());
    }
    registry
        .lock()
        .map_err(|_| IpcError::internal("The authorization service is unavailable"))?
        .inspect(token, &relative_path)
}

#[tauri::command]
pub async fn choose_and_open_documents(
    window: WebviewWindow,
    app: AppHandle,
    registry: State<'_, std::sync::Mutex<AuthorizationRegistry>>,
) -> Result<Vec<OpenDocument>, IpcError> {
    if window.label() != "main" {
        return Err(window_error());
    }
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("打开 Markdown 文件")
            .add_filter("Markdown", &["md", "markdown"])
            .blocking_pick_files()
    })
    .await
    .map_err(|_| IpcError::internal("The file picker could not be started"))?;
    let Some(selected) = selected else {
        return Ok(Vec::new());
    };
    let mut guard = registry
        .lock()
        .map_err(|_| IpcError::internal("The authorization service is unavailable"))?;
    selected
        .into_iter()
        .map(|file| {
            let path = file.into_path().map_err(|_| {
                IpcError::new(
                    markdown_studio::prototypes::authorization::ErrorCode::PathOutOfScope,
                    "The selected path is not a local file",
                )
            })?;
            let token = guard.authorize_file(&path)?;
            guard.read_document(token)
        })
        .collect()
}

#[tauri::command]
pub fn open_document(
    window: WebviewWindow,
    registry: State<'_, std::sync::Mutex<AuthorizationRegistry>>,
    token: AuthorizationToken,
) -> Result<OpenDocument, IpcError> {
    if window.label() != "main" {
        return Err(window_error());
    }
    registry
        .lock()
        .map_err(|_| IpcError::internal("The authorization service is unavailable"))?
        .read_document(token)
}

#[tauri::command]
pub fn save_document(
    window: WebviewWindow,
    registry: State<'_, std::sync::Mutex<AuthorizationRegistry>>,
    token: AuthorizationToken,
    text: String,
    metadata: TextMetadata,
    revision: u64,
    expected_disk_version: DiskVersion,
) -> Result<SaveResult, IpcError> {
    if window.label() != "main" {
        return Err(window_error());
    }
    #[cfg(windows)]
    {
        registry
            .lock()
            .map_err(|_| IpcError::internal("The authorization service is unavailable"))?
            .save_document(token, &text, &metadata, revision, &expected_disk_version)
    }
    #[cfg(not(windows))]
    {
        let _ = (
            registry,
            token,
            text,
            metadata,
            revision,
            expected_disk_version,
        );
        Err(IpcError::new(
            markdown_studio::prototypes::authorization::ErrorCode::SaveFailed,
            "Safe saving is supported only on validated Windows NTFS volumes",
        ))
    }
}

#[tauri::command]
pub async fn save_document_as(
    window: WebviewWindow,
    app: AppHandle,
    registry: State<'_, std::sync::Mutex<AuthorizationRegistry>>,
    text: String,
    metadata: TextMetadata,
    revision: u64,
) -> Result<Option<OpenDocument>, IpcError> {
    if window.label() != "main" {
        return Err(window_error());
    }
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("另存 Markdown 文件")
            .set_file_name("未命名.md")
            .add_filter("Markdown", &["md", "markdown"])
            .blocking_save_file()
    })
    .await
    .map_err(|_| IpcError::internal("The save dialog could not be started"))?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|_| {
        IpcError::new(
            markdown_studio::prototypes::authorization::ErrorCode::PathOutOfScope,
            "The selected path is not a local file",
        )
    })?;
    let _ = revision;
    #[cfg(windows)]
    {
        registry
            .lock()
            .map_err(|_| IpcError::internal("The authorization service is unavailable"))?
            .save_new_document(&path, &text, &metadata)
            .map(Some)
    }
    #[cfg(not(windows))]
    {
        let _ = (registry, text, metadata, revision, path);
        Err(IpcError::new(
            markdown_studio::prototypes::authorization::ErrorCode::SaveFailed,
            "Safe saving is supported only on validated Windows NTFS volumes",
        ))
    }
}

fn window_error() -> IpcError {
    IpcError::new(
        markdown_studio::prototypes::authorization::ErrorCode::PermissionDenied,
        "This window cannot access document files",
    )
}
