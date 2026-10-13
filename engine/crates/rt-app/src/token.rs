//! The per-launch API token: 128 random bits, as 32 hexadecimal digits.
//!
//! * Unix: 16 bytes from `/dev/urandom`.
//! * Windows (and as a fallback anywhere): `std`'s `RandomState`. Its SipHash keys are 128 bits
//!   taken from the operating system's random generator when the first one is created in a
//!   thread (`ProcessPrng` / `BCryptGenRandom` on Windows); every `RandomState` hashes with them.
//!   Two fresh states hash a counter, the time and the process id, and the two 64-bit outputs
//!   are the token. Without the keys the outputs cannot be predicted, and no `unsafe` code is
//!   needed to reach the system generator.
//!
//! The token never appears in a log, a file other than `instance.json` (in the user's own data
//! folder) or a URL that reaches the server: the window gets it in the fragment (`#token=`).

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::time::{SystemTime, UNIX_EPOCH};

/// A new random token.
pub fn generate() -> String {
    let mut bytes = [0u8; 16];
    if !fill_os(&mut bytes) {
        fill_hashed(&mut bytes);
    }
    crate::sha256::hex(&bytes)
}

#[cfg(unix)]
fn fill_os(out: &mut [u8; 16]) -> bool {
    use std::io::Read;
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(out))
        .is_ok()
}

#[cfg(not(unix))]
fn fill_os(_out: &mut [u8; 16]) -> bool {
    false
}

fn fill_hashed(out: &mut [u8; 16]) {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    for (i, chunk) in out.chunks_exact_mut(8).enumerate() {
        let mut h = RandomState::new().build_hasher();
        h.write_usize(i);
        h.write_u128(nanos);
        h.write_u32(std::process::id());
        chunk.copy_from_slice(&h.finish().to_le_bytes());
    }
}

/// True for a well-formed token (32 lower-case hexadecimal digits).
pub fn is_well_formed(token: &str) -> bool {
    token.len() == 32
        && token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Compares two strings in time that depends only on their lengths.
pub fn equals(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_128_bit_hex_and_differ() {
        let a = generate();
        let b = generate();
        assert!(is_well_formed(&a) && is_well_formed(&b));
        assert_ne!(a, b);
        let mut x = [0u8; 16];
        let mut y = [0u8; 16];
        fill_hashed(&mut x);
        fill_hashed(&mut y);
        assert_ne!(x, y, "the hashed fallback differs between calls too");
        assert_ne!(x, [0u8; 16]);
    }

    #[test]
    fn comparison() {
        assert!(equals("abc", "abc"));
        assert!(!equals("abc", "abd"));
        assert!(!equals("abc", "abcd"));
        assert!(!is_well_formed("ABCDEF0123456789abcdef0123456789"));
        assert!(!is_well_formed("abc"));
    }
}
