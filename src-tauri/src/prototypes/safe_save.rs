pub use super::authorization::DiskVersion;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    os::windows::{ffi::OsStrExt, fs::MetadataExt, io::AsRawHandle},
    path::{Path, PathBuf},
};
use uuid::Uuid;
use windows_sys::Win32::Storage::FileSystem::{
    BY_HANDLE_FILE_INFORMATION, GetDriveTypeW, GetFileInformationByHandle, GetVolumeInformationW,
    GetVolumePathNameW, MoveFileExW, ReplaceFileW,
};

#[derive(Debug)]
pub struct SaveFailure {
    pub code: &'static str,
    pub recovery: Option<PathBuf>,
    pub cause: Option<io::Error>,
}

impl From<io::Error> for SaveFailure {
    fn from(cause: io::Error) -> Self {
        Self {
            code: "IO_ERROR",
            recovery: None,
            cause: Some(cause),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    SnapshotPersisted,
    DuringCandidateWrite,
    BeforeCommit,
    AfterCommit,
}

#[derive(Debug)]
pub struct SaveReceipt {
    pub version: DiskVersion,
    pub recovery: PathBuf,
}

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

fn native_result(result: i32) -> io::Result<()> {
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

pub fn snapshot(path: &Path) -> io::Result<(DiskVersion, Vec<u8>)> {
    let mut file = File::open(path)?;
    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    native_result(unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut information) })?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let metadata = file.metadata()?;
    Ok((
        DiskVersion {
            file_id: format!(
                "{}:{}:{}",
                information.dwVolumeSerialNumber,
                information.nFileIndexHigh,
                information.nFileIndexLow
            ),
            hash: blake3::hash(&bytes).to_hex().to_string(),
            length: metadata.len(),
            modified: metadata.last_write_time(),
        },
        bytes,
    ))
}

pub fn validate_local_ntfs(path: &Path) -> io::Result<()> {
    let canonical = fs::canonicalize(path)?;
    for ancestor in path.ancestors() {
        if fs::symlink_metadata(ancestor)?.file_attributes() & 0x400 != 0 {
            return Err(io::Error::other("Reparse points are unsupported"));
        }
    }
    let mut volume = vec![0u16; 32768];
    native_result(unsafe {
        GetVolumePathNameW(
            wide(&canonical).as_ptr(),
            volume.as_mut_ptr(),
            volume.len() as u32,
        )
    })?;
    if unsafe { GetDriveTypeW(volume.as_ptr()) } != 3 {
        return Err(io::Error::other("Only fixed local volumes are supported"));
    }
    let mut filesystem = [0u16; 32];
    native_result(unsafe {
        GetVolumeInformationW(
            volume.as_ptr(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            filesystem.as_mut_ptr(),
            filesystem.len() as u32,
        )
    })?;
    let end = filesystem
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(filesystem.len());
    if String::from_utf16_lossy(&filesystem[..end]) != "NTFS" {
        return Err(io::Error::other("Only NTFS has been validated"));
    }
    Ok(())
}

fn persist(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

pub fn replace(target: &Path, candidate: &Path, backup: &Path) -> io::Result<()> {
    native_result(unsafe {
        ReplaceFileW(
            wide(target).as_ptr(),
            wide(candidate).as_ptr(),
            wide(backup).as_ptr(),
            0,
            std::ptr::null(),
            std::ptr::null(),
        )
    })
}

pub fn save_with_hook(
    target: &Path,
    expected: Option<&DiskVersion>,
    bytes: &[u8],
    mut hook: impl FnMut(Phase) -> io::Result<()>,
) -> Result<SaveReceipt, SaveFailure> {
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::other("Missing parent"))?;
    validate_local_ntfs(parent)?;
    if target.exists() {
        validate_local_ntfs(target)?;
    }
    let baseline = match snapshot(target) {
        Ok(snapshot) if Some(&snapshot.0) == expected => Some(snapshot),
        Err(error) if error.kind() == io::ErrorKind::NotFound && expected.is_none() => None,
        _ => {
            return Err(SaveFailure {
                code: "CONFLICT",
                recovery: None,
                cause: None,
            });
        }
    };
    let recovery = parent.join(format!(".markdown-studio-transaction-{}", Uuid::new_v4()));
    fs::create_dir(&recovery)?;
    let operation = || -> Result<SaveReceipt, SaveFailure> {
        persist(&recovery.join("local.md"), bytes)?;
        if let Some((_, base)) = &baseline {
            persist(&recovery.join("base.md"), base)?;
        }
        let manifest = serde_json::json!({ "version": 1, "target": target, "expected": expected });
        persist(
            &recovery.join("recovery.json"),
            &serde_json::to_vec(&manifest).map_err(io::Error::other)?,
        )?;
        hook(Phase::SnapshotPersisted)?;
        let candidate = recovery.join("candidate.md");
        let mut temporary = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&candidate)?;
        let middle = bytes.len() / 2;
        temporary.write_all(&bytes[..middle])?;
        hook(Phase::DuringCandidateWrite)?;
        temporary.write_all(&bytes[middle..])?;
        temporary.sync_all()?;
        drop(temporary);
        match (snapshot(target), expected) {
            (Ok((actual, _)), Some(expected)) if &actual == expected => {}
            (Err(error), None) if error.kind() == io::ErrorKind::NotFound => {}
            _ => {
                return Err(SaveFailure {
                    code: "CONFLICT",
                    recovery: None,
                    cause: None,
                });
            }
        }
        hook(Phase::BeforeCommit)?;
        if expected.is_some() {
            replace(target, &candidate, &recovery.join("disk.md"))?;
        } else {
            native_result(unsafe {
                MoveFileExW(wide(&candidate).as_ptr(), wide(target).as_ptr(), 8)
            })?;
        }
        hook(Phase::AfterCommit)?;
        if let Some(expected) = expected {
            let (backup_version, _) = snapshot(&recovery.join("disk.md"))?;
            if &backup_version != expected {
                return Err(SaveFailure {
                    code: "CONFLICT_DURING_COMMIT",
                    recovery: None,
                    cause: None,
                });
            }
        }
        let (version, actual) = snapshot(target)?;
        if actual != bytes {
            return Err(SaveFailure {
                code: "CONFLICT_DURING_COMMIT",
                recovery: None,
                cause: None,
            });
        }
        Ok(SaveReceipt {
            version,
            recovery: recovery.clone(),
        })
    };
    let mut operation = operation;
    operation().map_err(|mut failure| {
        failure.recovery = Some(recovery);
        failure
    })
}

pub fn recycle_with(
    path: &Path,
    operation: impl FnOnce(&Path) -> io::Result<()>,
) -> io::Result<()> {
    validate_local_ntfs(path)?;
    operation(path)
}

pub fn recycle(path: &Path) -> io::Result<()> {
    recycle_with(path, |target| {
        trash::delete(target).map_err(io::Error::other)
    })
}
