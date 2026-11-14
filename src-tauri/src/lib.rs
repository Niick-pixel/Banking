//! Colón desktop shell. The UI is the same React app as the web version; Rust
//! only provides safe file access to the data folder you chose (e.g. OneDrive\Colon).

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::thread::sleep;
use std::time::Duration;

/// Resolve `name` inside `dir`, refusing anything that could escape it.
fn safe_join(dir: &str, name: &str) -> Result<PathBuf, String> {
    let base = Path::new(dir);
    if !base.is_absolute() {
        return Err("Data folder must be an absolute path".into());
    }
    let rel = Path::new(name);
    if rel.is_absolute() || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("Invalid file name: {name}"));
    }
    Ok(base.join(rel))
}

/// OneDrive/antivirus can hold a file open for a moment; retry briefly.
fn retry<T>(mut f: impl FnMut() -> std::io::Result<T>) -> std::io::Result<T> {
    let mut last = None;
    for attempt in 0..8 {
        match f() {
            Ok(v) => return Ok(v),
            Err(e) => {
                last = Some(e);
                sleep(Duration::from_millis(60 * (attempt + 1)));
            }
        }
    }
    Err(last.unwrap())
}

#[tauri::command]
fn vault_read(dir: String, name: String) -> Result<Option<String>, String> {
    let path = safe_join(&dir, &name)?;
    if !path.exists() {
        return Ok(None);
    }
    retry(|| fs::read_to_string(&path)).map(Some).map_err(|e| format!("Reading {}: {e}", path.display()))
}

/// Atomic write: write a temp file next to the target, flush to disk, then rename
/// over the target. Sync clients only ever see the old file or the complete new one.
#[tauri::command]
fn vault_write_atomic(dir: String, name: String, contents: String) -> Result<(), String> {
    let path = safe_join(&dir, &name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    {
        let mut f: File = OpenOptions::new().write(true).create(true).truncate(true).open(&tmp).map_err(|e| e.to_string())?;
        f.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    // std::fs::rename replaces the destination atomically on Windows (MoveFileExW + REPLACE_EXISTING).
    retry(|| fs::rename(&tmp, &path)).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Saving {}: {e}", path.display())
    })
}

#[tauri::command]
fn vault_list(dir: String, sub: String) -> Result<Vec<String>, String> {
    let path = if sub.is_empty() { PathBuf::from(&dir) } else { safe_join(&dir, &sub)? };
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            out.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
fn vault_move(dir: String, from: String, to: String) -> Result<(), String> {
    let src = safe_join(&dir, &from)?;
    let dst = safe_join(&dir, &to)?;
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    retry(|| fs::rename(&src, &dst)).map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_delete(dir: String, name: String) -> Result<(), String> {
    let path = safe_join(&dir, &name)?;
    if path.exists() {
        retry(|| fs::remove_file(&path)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn ensure_dir(dir: String) -> Result<(), String> {
    let p = Path::new(&dir);
    if !p.is_absolute() {
        return Err("Folder must be an absolute path".into());
    }
    fs::create_dir_all(p).map_err(|e| e.to_string())
}

/// Suggest %OneDrive%\Colon (personal OneDrive first), else Documents\Colon.
#[tauri::command]
fn suggest_data_dir() -> Option<String> {
    for var in ["OneDriveConsumer", "OneDrive", "OneDriveCommercial"] {
        if let Ok(root) = std::env::var(var) {
            let p = Path::new(&root);
            if p.is_dir() {
                return Some(p.join("Colon").to_string_lossy().into_owned());
            }
        }
    }
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(|h| Path::new(&h).join("Documents").join("Colon").to_string_lossy().into_owned())
}

#[tauri::command]
fn device_name() -> String {
    gethostname::gethostname().to_string_lossy().into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        // A second launch focuses the existing window instead of opening another
        // instance writing to the same data file.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            vault_read,
            vault_write_atomic,
            vault_list,
            vault_move,
            vault_delete,
            ensure_dir,
            suggest_data_dir,
            device_name
        ])
        .run(tauri::generate_context!())
        .expect("error while running Colón");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("colon-test-{}-{}", std::process::id(), rand_suffix()));
        fs::create_dir_all(&d).unwrap();
        d
    }
    fn rand_suffix() -> u128 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    }

    #[test]
    fn rejects_escapes() {
        let d = tmpdir();
        let dir = d.to_string_lossy().to_string();
        assert!(safe_join(&dir, "../evil").is_err());
        assert!(safe_join(&dir, "backups/../../x").is_err());
        assert!(safe_join("relative", "x").is_err());
        assert!(safe_join(&dir, "backups/2026-11-14.colon").is_ok());
    }

    #[test]
    fn atomic_write_roundtrip_and_list() {
        let d = tmpdir();
        let dir = d.to_string_lossy().to_string();
        vault_write_atomic(dir.clone(), "colon-data.colon".into(), "one".into()).unwrap();
        vault_write_atomic(dir.clone(), "colon-data.colon".into(), "two".into()).unwrap();
        assert_eq!(vault_read(dir.clone(), "colon-data.colon".into()).unwrap().as_deref(), Some("two"));
        vault_write_atomic(dir.clone(), "backups/a.colon".into(), "b".into()).unwrap();
        assert_eq!(vault_list(dir.clone(), "".into()).unwrap(), vec!["colon-data.colon".to_string()]);
        assert_eq!(vault_list(dir.clone(), "backups".into()).unwrap(), vec!["a.colon".to_string()]);
        vault_move(dir.clone(), "colon-data.colon".into(), "backups/moved.colon".into()).unwrap();
        assert_eq!(vault_read(dir.clone(), "colon-data.colon".into()).unwrap(), None);
        vault_delete(dir.clone(), "backups/moved.colon".into()).unwrap();
        assert_eq!(vault_list(dir, "backups".into()).unwrap(), vec!["a.colon".to_string()]);
    }
}
