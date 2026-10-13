//! The log: `<data>/logs/repackshot.log`, appended to, rotated to `repackshot.log.1` past 1 MiB.
//! Lines also go to standard error (invisible in the windowless Windows build). Never log the
//! token.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::{Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

static LOG: Mutex<Option<File>> = Mutex::new(None);

/// Size past which the log is rotated when the launcher starts.
const ROTATE_BYTES: u64 = 1 << 20;

/// Opens the log in `dir` (created if needed). Without it, lines go to standard error only.
pub fn open(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join("repackshot.log");
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > ROTATE_BYTES) {
        let _ = std::fs::rename(&path, dir.join("repackshot.log.1"));
    }
    let file = OpenOptions::new().create(true).append(true).open(path)?;
    *LOG.lock().unwrap_or_else(PoisonError::into_inner) = Some(file);
    Ok(())
}

/// Writes one line, with the UTC time.
pub fn line(message: &str) {
    let text = format!("{} {message}\n", timestamp(SystemTime::now()));
    eprint!("{text}");
    if let Some(f) = LOG.lock().unwrap_or_else(PoisonError::into_inner).as_mut() {
        let _ = f.write_all(text.as_bytes());
    }
}

/// `YYYY-MM-DDTHH:MM:SSZ` (the civil date from days since 1970, Howard Hinnant's algorithm).
pub fn timestamp(t: SystemTime) -> String {
    let secs = t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let (days, rest) = (secs / 86_400, secs % 86_400);
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        rest / 60 % 60,
        rest % 60
    )
}

/// Logs a formatted line.
#[macro_export]
macro_rules! log {
    ($($arg:tt)*) => {
        $crate::log::line(&format!($($arg)*))
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn timestamps_are_utc_civil_dates() {
        assert_eq!(timestamp(UNIX_EPOCH), "1970-01-01T00:00:00Z");
        let t = UNIX_EPOCH + Duration::from_secs(1_760_340_000);
        assert_eq!(timestamp(t), "2025-10-13T07:20:00Z");
        let leap = UNIX_EPOCH + Duration::from_secs(951_782_400); // 2000-02-29
        assert_eq!(timestamp(leap), "2000-02-29T00:00:00Z");
    }
}
