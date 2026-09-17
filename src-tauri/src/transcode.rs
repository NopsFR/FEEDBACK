//! On-the-fly PCM for codecs the WebView can't decode (ALAC, AIFF on Chromium).
//! The track is exposed as a virtual 16-bit WAV so the <audio> element can still seek with Range requests:
//! a byte offset maps to a frame index, we seek the decoder there and decode just the requested window.
use std::fs::File;
use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

pub fn needs_transcode(codec: Option<&str>) -> bool {
    matches!(codec, Some("ALAC") | Some("AIFF"))
}

const HEADER: u64 = 44;

pub fn probe_is_alac(path: &Path) -> bool {
    let Ok(file) = File::open(path) else { return false };
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    hint.with_extension("m4a");
    let Ok(probed) = symphonia::default::get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default()) else { return false };
    let is_alac = probed.format.tracks().iter().any(|t| t.codec_params.codec == symphonia::core::codecs::CODEC_TYPE_ALAC);
    is_alac
}

fn wav_header(sample_rate: u32, channels: u16, data_len: u64) -> [u8; 44] {
    let mut h = [0u8; 44];
    let byte_rate = sample_rate * channels as u32 * 2;
    let data_len = data_len.min(u32::MAX as u64 - 36) as u32;
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36 + data_len).to_le_bytes());
    h[8..12].copy_from_slice(b"WAVE");
    h[12..16].copy_from_slice(b"fmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes());
    h[22..24].copy_from_slice(&channels.to_le_bytes());
    h[24..28].copy_from_slice(&sample_rate.to_le_bytes());
    h[28..32].copy_from_slice(&byte_rate.to_le_bytes());
    h[32..34].copy_from_slice(&(channels * 2).to_le_bytes());
    h[34..36].copy_from_slice(&16u16.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data_len.to_le_bytes());
    h
}

pub struct Window {
    pub bytes: Vec<u8>,
    pub start: u64,
    pub total: u64,
}

/// Decode bytes [start, start+max_len) of the virtual WAV. `duration_ms` is a fallback when the container lacks a frame count.
pub fn read_window(path: &Path, start: u64, max_len: u64, duration_ms: i64) -> Result<Window, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions { enable_gapless: true, ..Default::default() }, &MetadataOptions::default())
        .map_err(|e| e.to_string())?;
    let mut format = probed.format;
    let track = format.tracks().iter().find(|t| t.codec_params.codec != CODEC_TYPE_NULL).ok_or("no audio track")?;
    let track_id = track.id;
    let params = track.codec_params.clone();
    let sample_rate = params.sample_rate.ok_or("unknown sample rate")?;
    let channels = params.channels.map(|c| c.count() as u16).unwrap_or(2).max(1);
    let frames = params.n_frames.unwrap_or_else(|| (duration_ms.max(0) as u64 * sample_rate as u64) / 1000);
    let block = channels as u64 * 2;
    let data_len = frames * block;
    let total = HEADER + data_len;
    if start >= total {
        return Err("range beyond end".into());
    }
    let end = (start + max_len).min(total);
    let mut out: Vec<u8> = Vec::with_capacity((end - start) as usize);

    if start < HEADER {
        let h = wav_header(sample_rate, channels, data_len);
        out.extend_from_slice(&h[start as usize..HEADER.min(end) as usize]);
    }
    if end <= HEADER {
        return Ok(Window { bytes: out, start, total });
    }

    let data_start = start.max(HEADER) - HEADER;
    let first_frame = data_start / block;
    let mut skip_bytes = (data_start % block) as usize;
    let mut decoder = symphonia::default::get_codecs().make(&params, &DecoderOptions::default()).map_err(|e| e.to_string())?;

    let mut skip_frames: u64 = 0;
    if first_frame > 0 {
        let secs = first_frame as f64 / sample_rate as f64;
        match format.seek(SeekMode::Accurate, SeekTo::Time { time: Time::from(secs), track_id: Some(track_id) }) {
            Ok(seeked) => {
                // timestamps are in the track's time base; for these codecs that's 1/sample_rate
                skip_frames = seeked.required_ts.saturating_sub(seeked.actual_ts);
                decoder.reset();
            }
            Err(e) => return Err(format!("seek failed: {e}")),
        }
    }

    let mut buf: Option<SampleBuffer<i16>> = None;
    let want = (end - start) as usize;
    while out.len() < want {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymError::DecodeError(_)) => continue,
            Err(e) => return Err(e.to_string()),
        };
        let spec = *decoded.spec();
        let cap = decoded.capacity() as u64;
        let sb = buf.get_or_insert_with(|| SampleBuffer::<i16>::new(cap, spec));
        if (sb.capacity() as u64) < cap * spec.channels.count() as u64 {
            *sb = SampleBuffer::<i16>::new(cap, spec);
        }
        sb.copy_interleaved_ref(decoded);
        let mut samples = sb.samples();
        if skip_frames > 0 {
            let n = (skip_frames as usize * channels as usize).min(samples.len());
            samples = &samples[n..];
            skip_frames -= (n / channels as usize) as u64;
        }
        for s in samples {
            let b = s.to_le_bytes();
            if skip_bytes > 0 {
                // align to a partial-sample start (rare; browsers request aligned ranges)
                let k = skip_bytes.min(2);
                out.extend_from_slice(&b[k..]);
                skip_bytes -= k;
            } else {
                out.extend_from_slice(&b);
            }
            if out.len() >= want {
                break;
            }
        }
    }
    // Pad with silence if the container over-reported its length.
    if out.len() < want {
        out.resize(want, 0);
    }
    out.truncate(want);
    Ok(Window { bytes: out, start, total })
}

#[cfg(test)]
mod tests {
    #[test]
    fn header_is_wellformed() {
        let h = super::wav_header(44100, 2, 1000);
        assert_eq!(&h[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(h[40..44].try_into().unwrap()), 1000);
        assert_eq!(u16::from_le_bytes(h[32..34].try_into().unwrap()), 4);
    }
}
