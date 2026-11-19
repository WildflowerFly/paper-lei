use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct AuthorizationToken(Uuid);

impl AuthorizationToken {
    fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_string(self) -> String {
        self.0.to_string()
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
    fn from_io(error: std::io::Error) -> Self {
        let code = match error.kind() {
            std::io::ErrorKind::NotFound => ErrorCode::NotFound,
            std::io::ErrorKind::PermissionDenied => ErrorCode::PermissionDenied,
            _ => ErrorCode::PathOutOfScope,
        };
        Self::new(code, "The authorized entry could not be accessed")
    }

    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            retryable: false,
            operation_id: None,
            details: None,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            code: ErrorCode::PermissionDenied,
            message: message.into(),
            retryable: true,
            operation_id: None,
            details: None,
        }
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineEnding {
    Lf,
    CrLf,
    Cr,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMetadata {
    pub bom: bool,
    pub line_endings: Vec<LineEnding>,
    pub trailing_newline: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDocument {
    pub token: AuthorizationToken,
    pub name: String,
    pub display_path: String,
    pub identity: FileIdentity,
    pub text: String,
    pub metadata: TextMetadata,
    pub read_only: bool,
}

pub fn decode_document(bytes: &[u8]) -> Result<(String, TextMetadata), IpcError> {
    let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let content = if bom { &bytes[3..] } else { bytes };
    let decoded = std::str::from_utf8(content).map_err(|_| {
        IpcError::new(
            ErrorCode::UnsupportedEncoding,
            "This file is not valid UTF-8 and was not opened for editing",
        )
    })?;
    let mut text = String::with_capacity(decoded.len());
    let mut line_endings = Vec::new();
    let mut characters = decoded.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\r' if characters.peek() == Some(&'\n') => {
                characters.next();
                text.push('\n');
                line_endings.push(LineEnding::CrLf);
            }
            '\r' => {
                text.push('\n');
                line_endings.push(LineEnding::Cr);
            }
            '\n' => {
                text.push('\n');
                line_endings.push(LineEnding::Lf);
            }
            _ => text.push(character),
        }
    }
    let trailing_newline = text.ends_with('\n');
    Ok((
        text,
        TextMetadata {
            bom,
            line_endings,
            trailing_newline,
        },
    ))
}

pub fn encode_document(text: &str, metadata: &TextMetadata) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(text.len() + usize::from(metadata.bom) * 3);
    if metadata.bom {
        bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
    }
    let mut line_endings = metadata.line_endings.iter();
    let fallback = primary_line_ending(&metadata.line_endings);
    for character in text.chars() {
        if character != '\n' {
            let mut encoded = [0; 4];
            bytes.extend_from_slice(character.encode_utf8(&mut encoded).as_bytes());
            continue;
        }
        match line_endings.next().copied().unwrap_or(fallback) {
            LineEnding::Lf => bytes.push(b'\n'),
            LineEnding::CrLf => bytes.extend_from_slice(b"\r\n"),
            LineEnding::Cr => bytes.push(b'\r'),
        }
    }
    bytes
}

fn primary_line_ending(line_endings: &[LineEnding]) -> LineEnding {
    let mut counts = [0; 3];
    for line_ending in line_endings {
        counts[match line_ending {
            LineEnding::Lf => 0,
            LineEnding::CrLf => 1,
            LineEnding::Cr => 2,
        }] += 1;
    }
    match counts.iter().enumerate().max_by_key(|(_, count)| *count) {
        Some((1, _)) => LineEnding::CrLf,
        Some((2, _)) => LineEnding::Cr,
        _ => LineEnding::Lf,
    }
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
        validate_selected_path(path)?;
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
        if matches!(kind, GrantKind::File)
            && let Some((existing, _)) = self.grants.iter().find(|(_, grant)| {
                grant.identity == entry.identity && matches!(grant.kind, GrantKind::File)
            })
        {
            return Ok(*existing);
        }
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

    pub fn read_document(&self, token: AuthorizationToken) -> Result<OpenDocument, IpcError> {
        let grant = self.grants.get(&token).ok_or_else(|| {
            IpcError::new(ErrorCode::InvalidToken, "Authorization token is invalid")
        })?;
        if !matches!(grant.kind, GrantKind::File) {
            return Err(IpcError::new(
                ErrorCode::PathOutOfScope,
                "A directory token cannot be read as a document",
            ));
        }
        let current = open_entry(&grant.canonical_path).map_err(IpcError::from_io)?;
        if current.identity != grant.identity {
            return Err(IpcError::new(
                ErrorCode::PathOutOfScope,
                "The authorized entry has changed",
            ));
        }
        let mut file = File::open(&grant.canonical_path).map_err(IpcError::from_io)?;
        if file_identity(&file).map_err(IpcError::from_io)? != grant.identity {
            return Err(IpcError::new(
                ErrorCode::PathOutOfScope,
                "The authorized entry has changed",
            ));
        }
        let read_only = file
            .metadata()
            .map_err(IpcError::from_io)?
            .permissions()
            .readonly();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).map_err(IpcError::from_io)?;
        let (text, metadata) = decode_document(&bytes)?;
        Ok(OpenDocument {
            token,
            name: grant
                .canonical_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_owned(),
            display_path: grant.canonical_path.display().to_string(),
            identity: grant.identity.clone(),
            text,
            metadata,
            read_only,
        })
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

fn validate_selected_path(path: &Path) -> Result<(), IpcError> {
    let raw = path.to_string_lossy();
    if raw.starts_with(r"\\.\") || raw.starts_with(r"\\?\GLOBALROOT\") {
        return Err(IpcError::new(
            ErrorCode::PathOutOfScope,
            "Device paths are not supported",
        ));
    }
    let mut components = path.components();
    let _prefix = components.next();
    for component in components {
        if component.as_os_str().to_string_lossy().contains(':') {
            return Err(IpcError::new(
                ErrorCode::PathOutOfScope,
                "Alternate data streams are not supported",
            ));
        }
    }
    Ok(())
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

#[cfg(windows)]
fn file_identity(file: &File) -> std::io::Result<FileIdentity> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::{
        Foundation::TRUE,
        Storage::FileSystem::{BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle},
    };
    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut information) } != TRUE {
        return Err(std::io::Error::last_os_error());
    }
    Ok(FileIdentity {
        volume: information.dwVolumeSerialNumber,
        index: format!(
            "{:08x}{:08x}",
            information.nFileIndexHigh, information.nFileIndexLow
        ),
    })
}

#[cfg(not(windows))]
fn file_identity(file: &File) -> std::io::Result<FileIdentity> {
    use std::os::unix::fs::MetadataExt;
    let metadata = file.metadata()?;
    Ok(FileIdentity {
        volume: metadata.dev() as u32,
        index: metadata.ino().to_string(),
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

    #[test]
    fn preserves_utf8_bom_mixed_line_endings_and_trailing_newline() {
        let bytes = b"\xef\xbb\xbffirst\r\nsecond\nthird\rfourth";
        let (text, metadata) = decode_document(bytes).unwrap();
        assert_eq!(text, "first\nsecond\nthird\nfourth");
        assert!(metadata.bom);
        assert_eq!(
            metadata.line_endings,
            vec![LineEnding::CrLf, LineEnding::Lf, LineEnding::Cr]
        );
        assert!(!metadata.trailing_newline);
        assert_eq!(encode_document(&text, &metadata), bytes);
    }

    #[test]
    fn preserves_lf_trailing_newline_and_rejects_non_utf8() {
        let bytes = b"one\ntwo\n";
        let (text, metadata) = decode_document(bytes).unwrap();
        assert_eq!(text, "one\ntwo\n");
        assert!(!metadata.bom);
        assert!(metadata.trailing_newline);
        assert_eq!(encode_document(&text, &metadata), bytes);
        assert_eq!(
            decode_document(&[0xff, 0xfe]).unwrap_err().code,
            ErrorCode::UnsupportedEncoding
        );
    }

    #[test]
    fn opens_markdown_with_metadata_and_reuses_file_authorization() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("notes.markdown");
        let bytes = b"\xef\xbb\xbffirst\r\nsecond\n";
        fs::write(&path, bytes).unwrap();
        let mut registry = AuthorizationRegistry::default();
        let token = registry.authorize_file(&path).unwrap();
        assert_eq!(registry.authorize_file(&path).unwrap(), token);

        let document = registry.read_document(token).unwrap();
        assert_eq!(document.token, token);
        assert_eq!(document.name, "notes.markdown");
        assert_eq!(document.text, "first\nsecond\n");
        assert!(document.metadata.bom);
        assert!(document.metadata.trailing_newline);
        assert_eq!(
            document.metadata.line_endings,
            vec![LineEnding::CrLf, LineEnding::Lf]
        );
        assert_eq!(encode_document(&document.text, &document.metadata), bytes);
    }

    #[test]
    fn rejects_device_and_alternate_data_stream_paths() {
        assert_eq!(
            validate_selected_path(Path::new(r"\\.\COM1"))
                .unwrap_err()
                .code,
            ErrorCode::PathOutOfScope
        );
        assert_eq!(
            validate_selected_path(Path::new(r"C:\notes.md:secret"))
                .unwrap_err()
                .code,
            ErrorCode::PathOutOfScope
        );
    }
}
