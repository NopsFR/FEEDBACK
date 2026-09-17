//! Local certificate authority for the LAN server.
//! iOS requirements for user-trusted roots: leaf must carry SANs and serverAuth EKU, ≤ 825 days validity.
use rcgen::{BasicConstraints, CertificateParams, DistinguishedName, DnType, ExtendedKeyUsagePurpose, IsCa, KeyPair, KeyUsagePurpose, SanType};
use std::net::IpAddr;
use std::path::Path;

pub struct Pem {
    pub ca_cert: String,
    pub leaf_cert: String,
    pub leaf_key: String,
}

fn ca_params() -> CertificateParams {
    let mut p = CertificateParams::default();
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, "FEEDBACK Local Library CA");
    dn.push(DnType::OrganizationName, "FEEDBACK (this computer)");
    p.distinguished_name = dn;
    p.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    p.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign, KeyUsagePurpose::DigitalSignature];
    p.not_before = rcgen::date_time_ymd(2024, 1, 1);
    p.not_after = rcgen::date_time_ymd(2036, 1, 1);
    p
}

/// Load or create the CA, then issue a fresh leaf for the given IPs/hostnames.
pub fn ensure(dir: &Path, ips: &[IpAddr], hostnames: &[String]) -> Result<Pem, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let ca_key_path = dir.join("ca.key.pem");
    let ca_cert_path = dir.join("ca.cert.pem");
    let ca_key = if ca_key_path.exists() {
        KeyPair::from_pem(&std::fs::read_to_string(&ca_key_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?
    } else {
        let k = KeyPair::generate().map_err(|e| e.to_string())?;
        std::fs::write(&ca_key_path, k.serialize_pem()).map_err(|e| e.to_string())?;
        k
    };
    // Re-sign the CA cert deterministically from stored params + key so it stays identical across launches.
    let ca_cert = ca_params().self_signed(&ca_key).map_err(|e| e.to_string())?;
    let ca_pem = if ca_cert_path.exists() {
        std::fs::read_to_string(&ca_cert_path).map_err(|e| e.to_string())?
    } else {
        let pem = ca_cert.pem();
        std::fs::write(&ca_cert_path, &pem).map_err(|e| e.to_string())?;
        pem
    };

    let mut leaf = CertificateParams::default();
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, "FEEDBACK on this computer");
    leaf.distinguished_name = dn;
    let mut sans: Vec<SanType> = ips.iter().map(|ip| SanType::IpAddress(*ip)).collect();
    for h in hostnames {
        if let Ok(n) = h.clone().try_into() {
            sans.push(SanType::DnsName(n));
        }
    }
    leaf.subject_alt_names = sans;
    leaf.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    leaf.key_usages = vec![KeyUsagePurpose::DigitalSignature, KeyUsagePurpose::KeyEncipherment];
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    let days = |d: i64| rcgen::date_time_ymd(1970, 1, 1) + std::time::Duration::from_secs((now / 86400 + d).max(0) as u64 * 86400);
    leaf.not_before = days(-1);
    leaf.not_after = days(800);
    let leaf_key = KeyPair::generate().map_err(|e| e.to_string())?;
    let leaf_cert = leaf.signed_by(&leaf_key, &ca_cert, &ca_key).map_err(|e| e.to_string())?;
    let chain = format!("{}{}", leaf_cert.pem(), ca_pem);
    Ok(Pem { ca_cert: ca_pem, leaf_cert: chain, leaf_key: leaf_key.serialize_pem() })
}

