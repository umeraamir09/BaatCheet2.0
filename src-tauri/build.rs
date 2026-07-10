fn main() {
    // Only the public OAuth client id is compiled into the desktop binary. The
    // renderer must never be able to choose an OAuth client at runtime.
    let _ = dotenvy::from_filename("../.env.local");
    if let Ok(client_id) = std::env::var("DISCORD_CLIENT_ID")
        .or_else(|_| std::env::var("VITE_DISCORD_CLIENT_ID"))
    {
        println!("cargo:rustc-env=BAATCHEET_DISCORD_CLIENT_ID={client_id}");
    }
    println!("cargo:rerun-if-changed=../.env.local");
    tauri_build::build()
}
