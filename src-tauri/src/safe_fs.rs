use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub fn write_atomic(path: impl AsRef<Path>, data: impl AsRef<[u8]>) -> io::Result<()> {
	let path = path.as_ref();
	let tmp = temp_path(path);
	let result = write_synced(&tmp, data.as_ref()).and_then(|_| fs::rename(&tmp, path));
	if result.is_err() {
		let _ = fs::remove_file(&tmp);
	}
	result?;
	sync_parent(path);
	Ok(())
}

pub fn copy_synced(from: impl AsRef<Path>, to: impl AsRef<Path>) -> io::Result<u64> {
	let to = to.as_ref();
	let copied = fs::copy(from, to)?;
	OpenOptions::new().write(true).open(to)?.sync_all()?;
	Ok(copied)
}

fn temp_path(path: &Path) -> PathBuf {
	let mut name: OsString = path.file_name().map(OsString::from).unwrap_or_default();
	name.push(".tmp");
	path.with_file_name(name)
}

fn write_synced(path: &Path, data: &[u8]) -> io::Result<()> {
	let mut file = File::create(path)?;
	file.write_all(data)?;
	file.sync_all()
}

#[cfg(unix)]
fn sync_parent(path: &Path) {
	if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
		if let Ok(handle) = File::open(dir) {
			let _ = handle.sync_all();
		}
	}
}

#[cfg(not(unix))]
fn sync_parent(_path: &Path) {}

#[cfg(test)]
mod tests {
	use super::*;

	fn scratch(name: &str) -> PathBuf {
		let dir = std::env::temp_dir().join(format!("mapforge-safe-fs-{}-{}", name, std::process::id()));
		let _ = fs::remove_dir_all(&dir);
		fs::create_dir_all(&dir).unwrap();
		dir
	}

	#[test]
	fn replaces_existing_file_and_leaves_no_temp() {
		let dir = scratch("replace");
		let path = dir.join("map.otbm");
		fs::write(&path, b"old contents").unwrap();
		write_atomic(&path, b"new").unwrap();
		assert_eq!(fs::read(&path).unwrap(), b"new");
		assert!(!dir.join("map.otbm.tmp").exists());
		fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn failed_write_keeps_original() {
		let dir = scratch("fail");
		let path = dir.join("map.otbm");
		fs::write(&path, b"original").unwrap();
		fs::create_dir(dir.join("map.otbm.tmp")).unwrap();
		assert!(write_atomic(&path, b"new").is_err());
		assert_eq!(fs::read(&path).unwrap(), b"original");
		fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn copy_synced_copies_bytes() {
		let dir = scratch("copy");
		fs::write(dir.join("a"), b"payload").unwrap();
		copy_synced(dir.join("a"), dir.join("b")).unwrap();
		assert_eq!(fs::read(dir.join("b")).unwrap(), b"payload");
		fs::remove_dir_all(dir).unwrap();
	}
}
