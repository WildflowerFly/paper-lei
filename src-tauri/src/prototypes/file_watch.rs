use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    thread,
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Emitter};

struct WatchHandle {
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct FileWatchRegistry {
    watchers: HashMap<String, WatchHandle>,
}

impl FileWatchRegistry {
    pub fn watch(&mut self, app: AppHandle, token: String, path: &Path) -> std::io::Result<()> {
        if self.watchers.contains_key(&token) {
            return Ok(());
        }
        let target = PathBuf::from(path);
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let generation = Arc::new(AtomicU64::new(0));
        let worker_generation = Arc::clone(&generation);
        let initial = fingerprint(&target);
        let worker_token = token.clone();
        thread::spawn(move || {
            let mut previous = initial;
            while !worker_stop.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(150));
                let current = fingerprint(&target);
                if current == previous {
                    continue;
                }
                previous = current;
                let event_generation = worker_generation.fetch_add(1, Ordering::Relaxed) + 1;
                let app = app.clone();
                let token = worker_token.clone();
                let generation = Arc::clone(&worker_generation);
                thread::spawn(move || {
                    thread::sleep(Duration::from_millis(150));
                    if generation.load(Ordering::Relaxed) == event_generation {
                        let _ = app.emit("document-changed", token);
                    }
                });
            }
        });
        self.watchers.insert(token, WatchHandle { stop });
        Ok(())
    }

    pub fn unwatch(&mut self, token: &str) -> bool {
        self.watchers
            .remove(token)
            .map(|watch| watch.stop.store(true, Ordering::Relaxed))
            .is_some()
    }
}

impl Drop for FileWatchRegistry {
    fn drop(&mut self) {
        for watch in self.watchers.values() {
            watch.stop.store(true, Ordering::Relaxed);
        }
    }
}

fn fingerprint(path: &Path) -> Option<(String, String, u64, u128)> {
    use std::io::Read;

    let metadata = fs::metadata(path).ok()?;
    let modified = metadata
        .modified()
        .ok()?
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let identity = file_identity(path, &metadata)?;
    let mut file = fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    Some((
        identity,
        blake3::hash(&bytes).to_hex().to_string(),
        metadata.len(),
        modified,
    ))
}

#[cfg(windows)]
fn file_identity(path: &Path, _metadata: &fs::Metadata) -> Option<String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::{
        Foundation::TRUE,
        Storage::FileSystem::{BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle},
    };

    let file = fs::File::open(path).ok()?;
    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut information) } != TRUE {
        return None;
    }
    Some(format!(
        "{}:{}:{}",
        information.dwVolumeSerialNumber,
        information.nFileIndexHigh,
        information.nFileIndexLow
    ))
}

#[cfg(unix)]
fn file_identity(_path: &Path, metadata: &fs::Metadata) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    Some(format!("{}:{}", metadata.dev(), metadata.ino()))
}

#[cfg(not(any(unix, windows)))]
fn file_identity(_path: &Path, metadata: &fs::Metadata) -> Option<String> {
    Some(format!("{}:{}", metadata.len(), metadata.created().ok()?.elapsed().ok()?.as_nanos()))
}
