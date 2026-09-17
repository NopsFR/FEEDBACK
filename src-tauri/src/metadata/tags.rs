//! Tag + stream property extraction. Missing metadata falls back to filename / folder names.
use lofty::file::{AudioFile, FileType, TaggedFileExt};
use lofty::picture::PictureType;
use lofty::prelude::{Accessor, ItemKey};
use lofty::probe::Probe;
use lofty::tag::Tag;
use std::path::Path;

pub const AUDIO_EXTS: &[&str] = &["mp3", "flac", "wav", "aac", "m4a", "ogg", "oga", "opus", "alac", "aif", "aiff", "wv", "ape", "mpc"];
pub const VIDEO_EXTS: &[&str] = &["mp4", "m4v", "webm", "mkv", "mov"];

#[derive(Debug, Clone, PartialEq)]
pub enum MediaKind {
    Audio,
    Video,
}

pub fn kind_for(path: &Path) -> Option<MediaKind> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if AUDIO_EXTS.contains(&ext.as_str()) {
        Some(MediaKind::Audio)
    } else if VIDEO_EXTS.contains(&ext.as_str()) {
        Some(MediaKind::Video)
    } else {
        None
    }
}

#[derive(Debug, Default, Clone)]
pub struct TrackMeta {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_no: Option<u32>,
    pub track_total: Option<u32>,
    pub disc_no: Option<u32>,
    pub disc_total: Option<u32>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub duration_ms: u64,
    pub codec: Option<String>,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u8>,
    pub channels: Option<u8>,
    pub picture: Option<(Vec<u8>, Option<String>)>,
    pub has_embedded_lyrics: bool,
    pub rg_track_gain: Option<f64>,
    pub rg_album_gain: Option<f64>,
}

fn clean(s: Option<std::borrow::Cow<'_, str>>) -> Option<String> {
    s.map(|v| v.trim().trim_matches('\0').to_string()).filter(|v| !v.is_empty())
}

fn item(tag: &Tag, key: ItemKey) -> Option<String> {
    tag.get_string(key).map(|v| v.trim().trim_matches('\0').to_string()).filter(|v| !v.is_empty())
}

fn parse_year(s: &str) -> Option<i32> {
    let digits: String = s.chars().skip_while(|c| !c.is_ascii_digit()).take(4).collect();
    if digits.len() == 4 {
        digits.parse().ok().filter(|y| (1000..3000).contains(y))
    } else {
        None
    }
}

fn parse_gain(s: &str) -> Option<f64> {
    s.trim().trim_end_matches("dB").trim_end_matches("db").trim().parse().ok()
}

fn codec_name(ft: FileType, path: &Path) -> String {
    match ft {
        FileType::Mpeg => "MP3".into(),
        FileType::Flac => "FLAC".into(),
        FileType::Wav => "WAV".into(),
        FileType::Aac => "AAC".into(),
        FileType::Mp4 => {
            // AAC and ALAC share the MP4 container; ask symphonia which codec the audio track uses.
            if crate::transcode::probe_is_alac(path) { "ALAC".into() } else { "AAC".into() }
        }
        FileType::Vorbis => "Vorbis".into(),
        FileType::Opus => "Opus".into(),
        FileType::Aiff => "AIFF".into(),
        FileType::WavPack => "WavPack".into(),
        FileType::Ape => "APE".into(),
        FileType::Mpc => "Musepack".into(),
        FileType::Speex => "Speex".into(),
        _ => path.extension().and_then(|e| e.to_str()).unwrap_or("?").to_ascii_uppercase(),
    }
}

pub fn read(path: &Path) -> Result<TrackMeta, String> {
    let tagged = Probe::open(path)
        .map_err(|e| e.to_string())?
        .guess_file_type()
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;
    let props = tagged.properties();
    let mut m = TrackMeta {
        duration_ms: props.duration().as_millis() as u64,
        bitrate: props.audio_bitrate().or(props.overall_bitrate()),
        sample_rate: props.sample_rate(),
        bit_depth: props.bit_depth(),
        channels: props.channels(),
        codec: Some(codec_name(tagged.file_type(), path)),
        ..Default::default()
    };
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    if let Some(tag) = tag {
        m.title = clean(tag.title());
        m.artist = clean(tag.artist());
        m.album = clean(tag.album());
        m.genre = clean(tag.genre());
        m.track_no = tag.track();
        m.track_total = tag.track_total();
        m.disc_no = tag.disk();
        m.disc_total = tag.disk_total();
        m.album_artist = item(tag, ItemKey::AlbumArtist);
        m.year = item(tag, ItemKey::Year)
            .or_else(|| item(tag, ItemKey::RecordingDate))
            .or_else(|| item(tag, ItemKey::OriginalReleaseDate))
            .and_then(|s| parse_year(&s));
        m.has_embedded_lyrics = item(tag, ItemKey::Lyrics).is_some();
        m.rg_track_gain = item(tag, ItemKey::ReplayGainTrackGain).and_then(|s| parse_gain(&s));
        m.rg_album_gain = item(tag, ItemKey::ReplayGainAlbumGain).and_then(|s| parse_gain(&s));
        let pics = tag.pictures();
        let pic = pics.iter().find(|p| p.pic_type() == PictureType::CoverFront).or_else(|| pics.first());
        if let Some(p) = pic {
            m.picture = Some((p.data().to_vec(), p.mime_type().map(|t| t.as_str().to_string())));
        }
    }
    // Fall back to other tags for missing basics (e.g. ID3v1 + APE).
    if m.title.is_none() || m.artist.is_none() {
        for t in tagged.tags() {
            if m.title.is_none() { m.title = clean(t.title()); }
            if m.artist.is_none() { m.artist = clean(t.artist()); }
            if m.album.is_none() { m.album = clean(t.album()); }
        }
    }
    Ok(m)
}

pub fn embedded_lyrics(path: &Path) -> Option<String> {
    let tagged = Probe::open(path).ok()?.guess_file_type().ok()?.read().ok()?;
    tagged.tags().iter().find_map(|t| item(t, ItemKey::Lyrics))
}

/// "03 - Song Name.flac" -> (Some(3), "Song Name")
pub fn title_from_filename(path: &Path) -> (Option<u32>, String) {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Untitled").trim();
    let digits: String = stem.chars().take_while(|c| c.is_ascii_digit()).collect();
    if !digits.is_empty() && digits.len() <= 3 {
        let rest = stem[digits.len()..].trim_start_matches(|c: char| c == ' ' || c == '-' || c == '.' || c == '_').trim();
        if !rest.is_empty() {
            return (digits.parse().ok(), rest.to_string());
        }
    }
    (None, stem.replace('_', " "))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filename_titles() {
        assert_eq!(title_from_filename(Path::new("03 - Song Name.flac")), (Some(3), "Song Name".into()));
        assert_eq!(title_from_filename(Path::new("1999.mp3")), (None, "1999".into()));
        assert_eq!(title_from_filename(Path::new("my_track.ogg")), (None, "my track".into()));
    }
    #[test]
    fn years_and_gain() {
        assert_eq!(parse_year("2004-05-11"), Some(2004));
        assert_eq!(parse_year("nope"), None);
        assert_eq!(parse_gain("-6.20 dB"), Some(-6.2));
    }
}
