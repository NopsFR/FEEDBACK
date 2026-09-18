fn main() {
    // An optimized Cargo build alone does not enable Tauri's bundled frontend.
    if std::env::var("PROFILE").as_deref() == Ok("release") && tauri_build::is_dev() {
        panic!("Desktop releases must bundle the frontend. Run `pnpm tauri build`, not `cargo build --release`.");
    }
    tauri_build::build()
}
