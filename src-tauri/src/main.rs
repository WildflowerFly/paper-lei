#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ipc;

fn main() {
    tauri::Builder::default()
        .manage(std::sync::Mutex::new(
            markdown_studio::prototypes::authorization::AuthorizationRegistry::default(),
        ))
        .manage(std::sync::Mutex::new(
            markdown_studio::prototypes::file_watch::FileWatchRegistry::default(),
        ))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ipc::inspect_authorized_entry,
            ipc::choose_and_open_documents,
            ipc::open_document,
            ipc::read_latest_document,
            ipc::adopt_document_version,
            ipc::watch_document,
            ipc::unwatch_document,
            ipc::save_document,
            ipc::save_document_as
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 Markdown Studio");
}
