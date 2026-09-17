use serde::Serialize;

/// Errors surfaced to the UI. `message` is safe to show; `detail` is logged, never displayed raw.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error")]
    Db(#[from] rusqlite::Error),
    #[error("file error")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    User(String),
    #[error("not found")]
    NotFound,
}

pub type AppResult<T> = Result<T, AppError>;

#[derive(Serialize)]
struct Wire<'a> {
    code: &'a str,
    message: String,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let wire = match self {
            AppError::Db(e) => {
                log::error!(target: "DATABASE", "{e}");
                Wire { code: "database", message: "The library database had a problem. Your files are untouched.".into() }
            }
            AppError::Io(e) => {
                log::warn!(target: "LIBRARY", "{e}");
                let message = match e.kind() {
                    std::io::ErrorKind::NotFound => "That file or folder isn't there any more.".into(),
                    std::io::ErrorKind::PermissionDenied => "FEEDBACK doesn't have permission to read that location.".into(),
                    _ => "Couldn't read that file.".into(),
                };
                Wire { code: "io", message }
            }
            AppError::User(m) => Wire { code: "user", message: m.clone() },
            AppError::NotFound => Wire { code: "not_found", message: "That item no longer exists in your library.".into() },
        };
        wire.serialize(s)
    }
}
