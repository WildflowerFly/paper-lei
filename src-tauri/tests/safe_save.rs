#![cfg(windows)]

use markdown_studio::prototypes::safe_save::{
    Phase, recycle, recycle_with, replace, save_with_hook, snapshot,
};
use std::{fs, io, os::windows::fs::OpenOptionsExt, process::Command};

fn setup() -> (tempfile::TempDir, std::path::PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("测试 文档.md");
    fs::write(&path, "原始内容\r\n").unwrap();
    (directory, path)
}

#[test]
fn successful_save_preserves_original_and_local_snapshots() {
    let (_directory, path) = setup();
    let (expected, base) = snapshot(&path).unwrap();
    let receipt = save_with_hook(&path, Some(&expected), b"local", |_| Ok(())).unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"local");
    assert_eq!(snapshot(&path).unwrap().0, receipt.version);
    assert_eq!(fs::read(receipt.recovery.join("disk.md")).unwrap(), base);
    assert_eq!(fs::read(receipt.recovery.join("base.md")).unwrap(), base);
    assert_eq!(
        fs::read(receipt.recovery.join("local.md")).unwrap(),
        b"local"
    );
}

#[test]
fn external_changes_before_final_validation_never_get_overwritten() {
    let (_directory, path) = setup();
    let expected = snapshot(&path).unwrap().0;
    let error = save_with_hook(&path, Some(&expected), b"local", |phase| {
        if phase == Phase::SnapshotPersisted {
            fs::write(&path, b"external")?;
        }
        Ok(())
    })
    .unwrap_err();
    assert_eq!(error.code, "CONFLICT");
    assert_eq!(fs::read(&path).unwrap(), b"external");
    assert_eq!(
        fs::read(error.recovery.unwrap().join("local.md")).unwrap(),
        b"local"
    );
}

#[test]
fn last_window_external_write_is_reported_and_all_three_versions_survive() {
    let (_directory, path) = setup();
    let (expected, base) = snapshot(&path).unwrap();
    let error = save_with_hook(&path, Some(&expected), b"local", |phase| {
        if phase == Phase::BeforeCommit {
            fs::write(&path, b"external")?;
        }
        Ok(())
    })
    .unwrap_err();
    assert_eq!(error.code, "CONFLICT_DURING_COMMIT");
    let recovery = error.recovery.unwrap();
    assert_eq!(fs::read(recovery.join("base.md")).unwrap(), base);
    assert_eq!(fs::read(recovery.join("disk.md")).unwrap(), b"external");
    assert_eq!(fs::read(recovery.join("local.md")).unwrap(), b"local");
}

#[test]
fn external_atomic_replacement_with_identical_bytes_still_reports_identity_conflict() {
    let (directory, path) = setup();
    let (expected, base) = snapshot(&path).unwrap();
    let replacement = directory.path().join("replacement.md");
    fs::write(&replacement, &base).unwrap();
    let error = save_with_hook(&path, Some(&expected), b"local", |phase| {
        if phase == Phase::BeforeCommit {
            replace(
                &path,
                &replacement,
                &directory.path().join("external-backup.md"),
            )?;
        }
        Ok(())
    })
    .unwrap_err();
    assert_eq!(error.code, "CONFLICT_DURING_COMMIT");
    let recovery = error.recovery.unwrap();
    assert_eq!(fs::read(recovery.join("disk.md")).unwrap(), base);
    assert_eq!(fs::read(recovery.join("local.md")).unwrap(), b"local");
}

#[test]
fn locked_target_and_injected_disk_full_preserve_data() {
    let (_directory, path) = setup();
    let (expected, base) = snapshot(&path).unwrap();
    let error = save_with_hook(&path, Some(&expected), b"local", |phase| {
        if phase == Phase::SnapshotPersisted {
            return Err(io::Error::from_raw_os_error(112));
        }
        Ok(())
    })
    .unwrap_err();
    assert_eq!(error.code, "IO_ERROR");
    assert_eq!(fs::read(&path).unwrap(), base);
    assert_eq!(
        fs::read(error.recovery.unwrap().join("local.md")).unwrap(),
        b"local"
    );
    let lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&path)
        .unwrap();
    assert!(save_with_hook(&path, Some(&expected), b"local", |_| Ok(())).is_err());
    drop(lock);
    assert_eq!(fs::read(&path).unwrap(), base);
}

#[test]
fn new_target_is_committed_without_overwrite_even_in_last_window_race() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("new.md");
    let error = save_with_hook(&path, None, b"local", |phase| {
        if phase == Phase::BeforeCommit {
            fs::write(&path, b"external")?;
        }
        Ok(())
    })
    .unwrap_err();
    assert_eq!(fs::read(&path).unwrap(), b"external");
    assert_eq!(
        fs::read(error.recovery.unwrap().join("local.md")).unwrap(),
        b"local"
    );
    let other = directory.path().join("other.md");
    save_with_hook(&other, None, b"new", |_| Ok(())).unwrap();
    assert_eq!(fs::read(&other).unwrap(), b"new");
}

#[test]
fn changed_after_commit_is_not_reported_saved() {
    let (_directory, path) = setup();
    let expected = snapshot(&path).unwrap().0;
    let error = save_with_hook(&path, Some(&expected), b"local", |phase| {
        if phase == Phase::AfterCommit {
            fs::write(&path, b"newest external")?;
        }
        Ok(())
    })
    .unwrap_err();
    assert_eq!(error.code, "CONFLICT_DURING_COMMIT");
    assert_eq!(fs::read(&path).unwrap(), b"newest external");
    assert_eq!(
        fs::read(error.recovery.unwrap().join("local.md")).unwrap(),
        b"local"
    );
}

#[test]
fn recycle_failure_never_falls_back_to_unlink() {
    let (_directory, path) = setup();
    let base = fs::read(&path).unwrap();
    let result = recycle_with(&path, |_| Err(io::Error::other("Injected shell failure")));
    assert!(result.is_err());
    assert_eq!(fs::read(&path).unwrap(), base);
}

#[test]
fn native_recycle_accepts_a_synthetic_file() {
    let (_directory, path) = setup();
    let base = fs::read(&path).unwrap();
    recycle(&path).unwrap();
    assert!(!path.exists());
    let item = trash::os_limited::list()
        .unwrap()
        .into_iter()
        .find(|item| item.original_path() == path)
        .expect("item must be recoverable in Windows Recycle Bin");
    trash::os_limited::restore_all([item]).unwrap();
    assert_eq!(fs::read(&path).unwrap(), base);
}

#[test]
fn interrupted_candidate_write_never_truncates_target() {
    let (_directory, path) = setup();
    let (expected, base) = snapshot(&path).unwrap();
    let failure = save_with_hook(&path, Some(&expected), b"local bytes", |phase| {
        if phase == Phase::DuringCandidateWrite {
            return Err(io::Error::from_raw_os_error(112));
        }
        Ok(())
    })
    .unwrap_err();
    assert_eq!(fs::read(&path).unwrap(), base);
    let recovery = failure.recovery.unwrap();
    assert_eq!(fs::read(recovery.join("local.md")).unwrap(), b"local bytes");
    assert_eq!(fs::read(recovery.join("candidate.md")).unwrap(), b"local");
}

#[test]
fn external_deletion_is_not_automatically_recreated() {
    let (_directory, path) = setup();
    let expected = snapshot(&path).unwrap().0;
    let failure = save_with_hook(&path, Some(&expected), b"local", |phase| {
        if phase == Phase::BeforeCommit {
            fs::remove_file(&path)?;
        }
        Ok(())
    })
    .unwrap_err();
    assert!(!path.exists());
    assert_eq!(
        fs::read(failure.recovery.unwrap().join("local.md")).unwrap(),
        b"local"
    );
}

#[test]
fn lock_acquired_in_the_last_window_preserves_original_and_edit_snapshot() {
    let (_directory, path) = setup();
    let (expected, base) = snapshot(&path).unwrap();
    let mut locked = None;
    let failure = save_with_hook(&path, Some(&expected), b"local", |phase| {
        if phase == Phase::BeforeCommit {
            locked = Some(
                fs::OpenOptions::new()
                    .read(true)
                    .share_mode(0)
                    .open(&path)?,
            );
        }
        Ok(())
    })
    .unwrap_err();
    drop(locked);
    assert_eq!(fs::read(&path).unwrap(), base);
    assert_eq!(
        fs::read(failure.recovery.unwrap().join("local.md")).unwrap(),
        b"local"
    );
}

#[test]
fn replace_preserves_windows_acl() {
    let (_directory, path) = setup();
    let acl = || {
        Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-Command",
                "(Get-Acl -LiteralPath $env:STUDIO_TEST_ACL_TARGET).Sddl",
            ])
            .env("STUDIO_TEST_ACL_TARGET", &path)
            .env_remove("PSModulePath")
            .output()
            .unwrap()
    };
    let before = acl();
    assert!(
        before.status.success(),
        "{}",
        String::from_utf8_lossy(&before.stderr)
    );
    let expected = snapshot(&path).unwrap().0;
    save_with_hook(&path, Some(&expected), b"local", |_| Ok(())).unwrap();
    let after = acl();
    assert!(
        after.status.success(),
        "{}",
        String::from_utf8_lossy(&after.stderr)
    );
    assert_eq!(before.stdout, after.stdout);
}

#[test]
fn crash_child() {
    let Ok(path) = std::env::var("STUDIO_TEST_CRASH_TARGET") else {
        return;
    };
    let path = std::path::Path::new(&path);
    let expected = snapshot(path).unwrap().0;
    let crash_at = if std::env::var("STUDIO_TEST_CRASH_PHASE").unwrap() == "before" {
        Phase::BeforeCommit
    } else {
        Phase::AfterCommit
    };
    let _ = save_with_hook(path, Some(&expected), b"local", |phase| {
        if phase == crash_at {
            std::process::exit(87);
        }
        Ok(())
    });
}

#[test]
fn process_termination_keeps_a_discoverable_recovery_manifest() {
    for phase in ["before", "after"] {
        let (directory, path) = setup();
        let base = fs::read(&path).unwrap();
        let status = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "crash_child"])
            .env("STUDIO_TEST_CRASH_TARGET", &path)
            .env("STUDIO_TEST_CRASH_PHASE", phase)
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(87));
        let recovery = fs::read_dir(directory.path())
            .unwrap()
            .filter_map(Result::ok)
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".markdown-studio-transaction-")
            })
            .unwrap()
            .path();
        assert!(recovery.join("recovery.json").exists());
        assert_eq!(fs::read(recovery.join("local.md")).unwrap(), b"local");
        assert_eq!(fs::read(recovery.join("base.md")).unwrap(), base);
        if phase == "before" {
            assert_eq!(fs::read(&path).unwrap(), base);
        } else {
            assert_eq!(fs::read(recovery.join("disk.md")).unwrap(), base);
        }
    }
}
