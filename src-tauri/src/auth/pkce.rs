use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::TryRngCore;
use sha2::{Digest, Sha256};

/// Generate `num_bytes` of OS randomness encoded as base64url-no-pad (unreserved-URL-safe).
///
/// Panics if the OS entropy source is unavailable — PKCE verifier + CSRF state
/// must come from a CSPRNG; there's no graceful fallback for desktop auth.
pub fn random_url_safe_token(num_bytes: usize) -> String {
    let mut bytes = vec![0u8; num_bytes];
    rand::rngs::OsRng
        .try_fill_bytes(&mut bytes)
        .expect("OS entropy source (OsRng) unavailable — cannot generate secure auth tokens");
    URL_SAFE_NO_PAD.encode(&bytes)
}

/// PKCE code verifier — 64 random bytes → base64url no-pad (~86 chars),
/// within Discord's required 43–128 unreserved-URL-safe band (spec task 2.1).
pub fn generate_verifier() -> String {
    random_url_safe_token(64)
}

/// S256 PKCE challenge: base64url-no-pad(SHA256(verifier)), no padding (spec task 2.2).
pub fn challenge(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifier_length_is_within_discord_band() {
        let v = generate_verifier();
        assert!(
            (43..=128).contains(&v.len()),
            "verifier len {} outside 43..=128",
            v.len()
        );
    }

    #[test]
    fn verifier_is_unreserved_url_safe() {
        let v = generate_verifier();
        assert!(
            v.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
            "verifier contains non-unreserved char"
        );
    }

    #[test]
    fn challenge_is_deterministic() {
        let verifier = "test-verifier-not-random-just-fixed-12345";
        assert_eq!(challenge(verifier), challenge(verifier));
    }

    /// RFC 7636 Appendix B — known PKCE S256 test vector (base64url no-pad).
    /// 32-byte SHA256 → 43 base64url chars (no padding).
    #[test]
    fn challenge_matches_rfc_7636_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(challenge(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }
}