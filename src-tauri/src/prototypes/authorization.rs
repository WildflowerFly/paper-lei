use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct AuthorizationToken(Uuid);

impl AuthorizationToken {
    fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Serialize for AuthorizationToken {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.0.to_string())
    }
}

impl<'de> Deserialize<'de> for AuthorizationToken {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Uuid::parse_str(&value)
            .map(Self)
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcError {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    pub operation_id: Option<String>,
    pub details: Option<serde_json::Value>,
}

impl IpcError {
    fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            retryable: false,
            operation_id: None,
            details: None,
        }
    }

    fn from_io(error: std::io::Error) -> Self {
        let code = match error.kind() {
            std::io::ErrorKind::NotFound => ErrorCode::NotFound,
            std::io::ErrorKind::PermissionDenied => ErrorCode::PermissionDenied,
            _ => ErrorCode::PathOutOfScope,
        };
        Self::new(code, "The authorized entry could not be accessed")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    NotFound,
    PermissionDenied,
    PathOutOfScope,
    InvalidName,
    AlreadyExists,
    UnsupportedEncoding,
    ReadOnly,
    DiskFull,
    FileBusy,
    Conflict,
    ConflictDuringCommit,
    ResourceBlocked,
    RenderTimeout,
    ExportFailed,
    Cancelled,
    InvalidToken,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryInspection {
    pub name: String,
    pub is_directory: bool,
    pub identity: FileIdentity,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIdentity {
    pub volume: u32,
    pub index: String,
}

#[derive(Clone, Debug)]
enum GrantKind {
    File,
    Directory,
}

#[derive(Clone, Debug)]
struct Grant {
    canonical_path: PathBuf,
    identity: FileIdentity,
    kind: GrantKind,
}

#[derive(Default)]
pub struct AuthorizationRegistry {
    grants: HashMap<AuthorizationToken, Grant>,
}

impl AuthorizationRegistry {
    pub fn authorize_file(&mut self, path: &Path) -> Result<AuthorizationToken, IpcError> {
        self.authorize(path, GrantKind::File)
    }

    pub fn authorize_directory(&mut self, path: &Path) -> Result<AuthorizationToken, IpcError> {
        self.authorize(path, GrantKind::Directory)
    }

    fn authorize(&mut self, path: &Path, kind: GrantKind) -> Result<AuthorizationToken, IpcError> {
        let entry = open_entry(path).map_err(IpcError::from_io)?;
        match (&kind, entry.is_directory) {
            (GrantKind::File, true) | (GrantKind::Directory, false) => {
                return Err(IpcError::new(
                    ErrorCode::PathOutOfScope,
                    "The selected entry has an unexpected type",
                ));
            }
            _ => {}
        }
        if matches!(kind, GrantKind::File) {
            let extension = entry
                .canonical_path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if !extension.eq_ignore_ascii_case("md") && !extension.eq_ignore_ascii_case("markdown")
            {
                return Err(IpcError::new(
                    ErrorCode::PathOutOfScope,
                    "Only Markdown files can receive document access",
                ));
            }
        }
        let token = AuthorizationToken::new();
        self.grants.insert(
            token,
            Grant {
                canonical_path: entry.canonical_path,
                identity: entry.identity,
                kind,
            },
        );
        Ok(token)
    }

    pub fn inspect(
        &self,
        token: AuthorizationToken,
        relative_path: &str,
    ) -> Result<EntryInspection, IpcError> {
        let grant = self.grants.get(&token).ok_or_else(|| {
            IpcError::new(ErrorCode::InvalidToken, "Authorization token is invalid")
        })?;
        let current_root = open_entry(&grant.canonical_path).map_err(IpcError::from_io)?;
        if current_root.identity != grant.identity {
            return Err(IpcError::new(
                ErrorCode::PathOutOfScope,
                "The authorized entry has changed",
            ));
        }
        let relative = validate_relative_path(relative_path)?;
        let target = match grant.kind {
            GrantKind::File if relative.as_os_str().is_empty() => grant.canonical_path.clone(),
            GrantKind::File => {
                return Err(IpcError::new(
                    ErrorCode::PathOutOfScope,
                    "A document token cannot access sibling entries",
                ));
            }
            GrantKind::Directory => grant.canonical_path.join(relative),
        };
        let entry = open_entry(&target).map_err(IpcError::from_io)?;
        if !is_within(&grant.canonical_path, &entry.canonical_path) {
            return Err(IpcError::new(
                ErrorCode::PathOutOfScope,
                "The entry resolves outside its authorized directory",
            ));
        }
        Ok(EntryInspection {
            name: entry
                .canonical_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_owned(),
            is_directory: entry.is_directory,
            identity: entry.identity,
        })
    }

    pub fn revoke(&mut self, token: AuthorizationToken) -> bool {
        self.grants.remove(&token).is_some()
    }
}

pub fn validate_name(name: &str) -> Result<(), IpcError> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.ends_with([' ', '.'])
        || name.encode_utf16().count() > 255
        || name
            .chars()
            .any(|character| character < '\u{20}' || "<>:\"/\\|?*".contains(character))
    {
        return Err(IpcError::new(
            ErrorCode::InvalidName,
            "The entry name is not valid on Windows",
        ));
    }
    let stem = name.split('.').next().unwrap_or_default().to_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
    if reserved {
        return Err(IpcError::new(
            ErrorCode::InvalidName,
            "The entry name is reserved by Windows",
        ));
    }
    Ok(())
}

fn validate_relative_path(value: &str) -> Result<PathBuf, IpcError> {
    if value.is_empty() {
        return Ok(PathBuf::new());
    }
    if value.starts_with(['\\', '/']) || value.contains(':') || value.contains('\0') {
        return Err(IpcError::new(
            ErrorCode::PathOutOfScope,
            "Only relative paths are accepted",
        ));
    }
    let normalized = value.replace('\\', "/");
    let mut result = PathBuf::new();
    for component in normalized.split('/') {
        if component.is_empty() || component == "." || component == ".." {
            return Err(IpcError::new(
                ErrorCode::PathOutOfScope,
                "The relative path contains an invalid component",
            ));
        }
        validate_name(component)?;
        result.push(component);
    }
    for component in result.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(IpcError::new(
                ErrorCode::PathOutOfScope,
                "Only normal relative path components are accepted",
            ));
        }
    }
    Ok(result)
}

fn is_within(root: &Path, target: &Path) -> bool {
    let root = root.components().map(component_key).collect::<Vec<_>>();
    let target = target.components().map(component_key).collect::<Vec<_>>();
    target.len() >= root.len() && target[..root.len()] == root
}

fn component_key(component: Component<'_>) -> String {
    component.as_os_str().to_string_lossy().to_lowercase()
}

struct OpenEntry {
    canonical_path: PathBuf,
    identity: FileIdentity,
    is_directory: bool,
}

#[cfg(windows)]
fn open_entry(path: &Path) -> std::io::Result<OpenEntry> {
    use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
    use windows_sys::Win32::{
        Foundation::TRUE,
        Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY, FILE_FLAG_BACKUP_SEMANTICS,
            GetFileInformationByHandle,
        },
    };

    let canonical_path = fs::canonicalize(path)?;
    let metadata = fs::metadata(&canonical_path)?;
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(&canonical_path)?;
    let handle = file.as_raw_handle();
    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(handle, &mut information) } != TRUE {
        return Err(std::io::Error::last_os_error());
    }
    Ok(OpenEntry {
        canonical_path,
        identity: FileIdentity {
            volume: information.dwVolumeSerialNumber,
            index: format!(
                "{:08x}{:08x}",
                information.nFileIndexHigh, information.nFileIndexLow
            ),
        },
        is_directory: metadata.is_dir()
            || information.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0,
    })
}

#[cfg(not(windows))]
fn open_entry(path: &Path) -> std::io::Result<OpenEntry> {
    let canonical_path = fs::canonicalize(path)?;
    let metadata = fs::metadata(&canonical_path)?;
    use std::os::unix::fs::MetadataExt;
    Ok(OpenEntry {
        canonical_path,
        identity: FileIdentity {
            volume: metadata.dev() as u32,
            index: metadata.ino().to_string(),
        },
        is_directory: metadata.is_dir(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn rejects_invalid_windows_names_and_device_paths() {
        for name in [
            "", ".", "..", "notes.", "notes ", "a:b", "NUL", "com1.txt", "bad?.md",
        ] {
            assert!(validate_name(name).is_err(), "accepted {name:?}");
        }
        for path in [
            "../outside.md",
            "..\\outside.md",
            "C:\\secret.md",
            "\\\\server\\share\\a.md",
            "\\\\.\\COM1",
            "notes.md:secret",
        ] {
            assert!(validate_relative_path(path).is_err(), "accepted {path:?}");
        }
    }

    #[test]
    fn accepts_unicode_spaces_and_nested_relative_names() {
        validate_name("我的 文件").unwrap();
        assert_eq!(
            validate_relative_path("子目录/我的 文件.md").unwrap(),
            PathBuf::from("子目录").join("我的 文件.md")
        );
    }

    #[test]
    fn tokens_are_scoped_to_identity_and_revoke_cleanly() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("中文 文件.md");
        fs::write(&path, "content").unwrap();
        let mut registry = AuthorizationRegistry::default();
        let token = registry.authorize_file(&path).unwrap();
        let invalid: AuthorizationToken =
            serde_json::from_str("\"00000000-0000-0000-0000-000000000001\"").unwrap();
        assert_eq!(
            registry.inspect(invalid, "").unwrap_err().code,
            ErrorCode::InvalidToken
        );
        assert!(registry.inspect(token, "").is_ok());
        assert_eq!(
            registry.inspect(token, "sibling.md").unwrap_err().code,
            ErrorCode::PathOutOfScope
        );
        assert!(registry.revoke(token));
        assert_eq!(
            registry.inspect(token, "").unwrap_err().code,
            ErrorCode::InvalidToken
        );
    }

    #[test]
    fn directory_tokens_reject_out_of_scope_junction_targets() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let external_file = outside.path().join("secret.md");
        fs::write(&external_file, "secret").unwrap();
        let junction = root.path().join("escape");
        #[cfg(windows)]
        {
            let status = std::process::Command::new("cmd.exe")
                .args(["/D", "/C", "mklink", "/J"])
                .arg(&junction)
                .arg(outside.path())
                .status()
                .unwrap();
            assert!(status.success());
        }
        #[cfg(not(windows))]
        std::os::unix::fs::symlink(outside.path(), &junction).unwrap();
        let mut registry = AuthorizationRegistry::default();
        let token = registry.authorize_directory(root.path()).unwrap();
        assert_eq!(
            registry
                .inspect(token, "escape/secret.md")
                .unwrap_err()
                .code,
            ErrorCode::PathOutOfScope
        );
        assert!(registry.inspect(token, "escape").unwrap_err().code == ErrorCode::PathOutOfScope);
    }

    #[test]
    fn replacing_authorized_file_invalidates_identity() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("notes.md");
        let replacement = directory.path().join("replacement.md");
        fs::write(&path, "first").unwrap();
        fs::write(&replacement, "second").unwrap();
        let mut registry = AuthorizationRegistry::default();
        let token = registry.authorize_file(&path).unwrap();
        fs::remove_file(&path).unwrap();
        fs::rename(&replacement, &path).unwrap();
        assert_eq!(
            registry.inspect(token, "").unwrap_err().code,
            ErrorCode::PathOutOfScope
        );
    }
}
