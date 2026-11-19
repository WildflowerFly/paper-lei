use serde_json::{Value, json};

#[test]
fn startup_only_grants_the_main_window_its_declared_capability() {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let capability: Value =
        serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
    assert_eq!(config["app"]["security"]["capabilities"], json!(["main"]));
    assert_eq!(capability["identifier"], "main");
    assert_eq!(capability["windows"], json!(["main"]));
    assert_eq!(
        capability["permissions"],
        json!([
            "allow-inspect-authorized-entry",
            "allow-choose-and-open-documents",
            "allow-open-document",
            "dialog:allow-open"
        ])
    );
    assert!(capability.get("remote").is_none());
    let manifest = include_str!("../build.rs");
    assert!(manifest.contains("inspect_authorized_entry"));
    assert!(manifest.contains("choose_and_open_documents"));
    assert!(manifest.contains("open_document"));
}
