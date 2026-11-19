#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ipc;

fn main() {
    tauri::Builder::default()
        .manage(std::sync::Mutex::new(
            markdown_studio::prototypes::authorization::AuthorizationRegistry::default(),
        ))
        .invoke_handler(tauri::generate_handler![ipc::inspect_authorized_entry])
        .run(tauri::generate_context!())
        .expect("无法启动 Markdown Studio");
}
