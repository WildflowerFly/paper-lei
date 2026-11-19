fn main() {
    let attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "inspect_authorized_entry",
            "choose_and_open_documents",
            "open_document",
        ]));
    tauri_build::try_build(attributes).expect("failed to build Tauri ACL");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let resource = if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
            "resource.lib"
        } else {
            "libresource.a"
        };
        println!(
            "cargo:rustc-link-arg-examples={}",
            output.join(resource).display()
        );
    }
}
