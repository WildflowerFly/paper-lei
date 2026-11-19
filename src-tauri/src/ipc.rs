use markdown_studio::prototypes::authorization::{
    AuthorizationRegistry, AuthorizationToken, EntryInspection, IpcError,
};
use tauri::{State, WebviewWindow};

#[tauri::command]
pub fn inspect_authorized_entry(
    window: WebviewWindow,
    registry: State<'_, std::sync::Mutex<AuthorizationRegistry>>,
    token: AuthorizationToken,
    relative_path: String,
) -> Result<EntryInspection, IpcError> {
    if window.label() != "main" {
        return Err(IpcError {
            code: markdown_studio::prototypes::authorization::ErrorCode::PermissionDenied,
            message: "This window cannot access document files".into(),
            retryable: false,
            operation_id: None,
            details: None,
        });
    }
    registry
        .lock()
        .map_err(|_| IpcError {
            code: markdown_studio::prototypes::authorization::ErrorCode::PermissionDenied,
            message: "The authorization service is unavailable".into(),
            retryable: true,
            operation_id: None,
            details: None,
        })?
        .inspect(token, &relative_path)
}
