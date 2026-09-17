//! Artwork cache: originals stored once by content hash; JPEG thumbnails at fixed sizes; a small palette for ambient colour.
use image::{imageops::FilterType, DynamicImage, GenericImageView};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};

pub const SIZES: &[u32] = &[160, 480];
const FOLDER_ART: &[&str] = &["cover", "folder", "front", "album", "artwork", "art"];

pub struct ArtCache {
    pub dir: PathBuf,
}

impl ArtCache {
    pub fn new(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        Self { dir }
    }

    pub fn original_path(&self, hash: &str) -> PathBuf {
        self.dir.join(&hash[..2]).join(format!("{hash}.orig"))
    }

    pub fn thumb_path(&self, hash: &str, size: u32) -> PathBuf {
        self.dir.join(&hash[..2]).join(format!("{hash}-{size}.jpg"))
    }

    /// Store raw image bytes; returns content hash. Idempotent.
    pub fn store(&self, conn: &Connection, bytes: &[u8], mime: Option<&str>) -> Option<String> {
        if bytes.len() < 64 || bytes.len() > 40 * 1024 * 1024 {
            return None;
        }
        let hash = blake3::hash(bytes).to_hex()[..32].to_string();
        let known: Option<String> = conn
            .query_row("SELECT hash FROM artwork WHERE hash = ?1", [&hash], |r| r.get(0))
            .optional()
            .ok()
            .flatten();
        if known.is_some() && self.thumb_path(&hash, SIZES[0]).exists() {
            return Some(hash);
        }
        let img = match image::load_from_memory(bytes) {
            Ok(i) => i,
            Err(e) => {
                log::debug!(target: "LIBRARY", "artwork decode failed: {e}");
                return None;
            }
        };
        let (w, h) = img.dimensions();
        let orig = self.original_path(&hash);
        if let Some(parent) = orig.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if std::fs::write(&orig, bytes).is_err() {
            return None;
        }
        for &s in SIZES {
            let _ = write_thumb(&img, s, &self.thumb_path(&hash, s));
        }
        let palette = palette(&img);
        let _ = conn.execute(
            "INSERT OR REPLACE INTO artwork(hash, mime, width, height, palette) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![hash, mime, w, h, palette],
        );
        Some(hash)
    }

    pub fn from_folder(&self, conn: &Connection, dir: &Path) -> Option<String> {
        let entries = std::fs::read_dir(dir).ok()?;
        let mut candidates: Vec<(usize, PathBuf)> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                matches!(p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(), Some("jpg" | "jpeg" | "png" | "webp"))
            })
            .map(|p| {
                let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
                let rank = FOLDER_ART.iter().position(|n| stem == *n || stem.starts_with(n)).unwrap_or(99);
                (rank, p)
            })
            .collect();
        candidates.sort();
        let (rank, path) = candidates.into_iter().next()?;
        if rank == 99 {
            return None;
        }
        let bytes = std::fs::read(&path).ok()?;
        self.store(conn, &bytes, None)
    }
}

fn write_thumb(img: &DynamicImage, size: u32, out: &Path) -> image::ImageResult<()> {
    let (w, h) = img.dimensions();
    // Never crop: fit within size x size, keep aspect.
    let thumb = if w.max(h) > size { img.resize(size, size, FilterType::Lanczos3) } else { img.clone() };
    let rgb = thumb.to_rgb8();
    let mut f = std::io::BufWriter::new(std::fs::File::create(out)?);
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut f, 86);
    enc.encode_image(&rgb)
}

/// Two usable ambient colours ("#rrggbb,#rrggbb"). Rejects near-black, near-white and blown-out samples.
pub fn palette(img: &DynamicImage) -> String {
    let small = img.resize_exact(24, 24, FilterType::Triangle).to_rgb8();
    let mut buckets: std::collections::HashMap<(u8, u8, u8), (u32, [u32; 3])> = std::collections::HashMap::new();
    for p in small.pixels() {
        let [r, g, b] = p.0;
        let max = r.max(g).max(b) as i32;
        let min = r.min(g).min(b) as i32;
        let lum = (r as i32 * 3 + g as i32 * 6 + b as i32) / 10;
        if lum < 22 || lum > 235 {
            continue;
        }
        let sat = if max == 0 { 0 } else { (max - min) * 255 / max };
        let key = (r / 48, g / 48, b / 48);
        let e = buckets.entry(key).or_insert((0, [0, 0, 0]));
        let weight = 1 + (sat as u32 / 64);
        e.0 += weight;
        e.1[0] += r as u32 * weight;
        e.1[1] += g as u32 * weight;
        e.1[2] += b as u32 * weight;
    }
    let mut v: Vec<_> = buckets.into_values().collect();
    v.sort_by(|a, b| b.0.cmp(&a.0));
    let col = |e: &(u32, [u32; 3])| format!("#{:02x}{:02x}{:02x}", e.1[0] / e.0, e.1[1] / e.0, e.1[2] / e.0);
    match v.len() {
        0 => "#2a2a2a,#161616".into(),
        1 => format!("{},{}", col(&v[0]), col(&v[0])),
        _ => {
            // second colour: most frequent that differs enough from the first
            let first = v[0];
            let dist = |a: &(u32, [u32; 3]), b: &(u32, [u32; 3])| {
                (0..3).map(|i| ((a.1[i] / a.0) as i32 - (b.1[i] / b.0) as i32).abs()).sum::<i32>()
            };
            let second = v.iter().skip(1).find(|e| dist(e, &first) > 90).unwrap_or(&v[1]);
            format!("{},{}", col(&first), col(second))
        }
    }
}
