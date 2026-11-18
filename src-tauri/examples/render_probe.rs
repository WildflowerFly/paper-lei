#[cfg(windows)]
mod native {
    use std::{
        fs,
        path::PathBuf,
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
        time::{Duration, Instant},
    };
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, webview::PageLoadEvent};
    use webview2_com::ExecuteScriptCompletedHandler;
    use windows_core::HSTRING;

    const SOURCES: [&str; 6] = [
        "flowchart LR\nA[开始] --> B[完成]",
        "sequenceDiagram\nAlice->>Bob: 你好",
        "classDiagram\nclass Document\nDocument : title",
        "stateDiagram-v2\n[*] --> Ready\nReady --> [*]",
        "gantt\ntitle 任务\ndateFormat YYYY-MM-DD\nsection 实现\n原型 :2026-11-18, 1d",
        "pie title 分类\n\"源码\" : 60\n\"预览\" : 40",
    ];

    pub fn run() -> Result<(), Box<dyn std::error::Error>> {
        let mode = std::env::args().nth(1).unwrap_or_else(|| "all".into());
        if !["all", "invalid", "oversize", "stall", "host"].contains(&mode.as_str()) {
            return Err("invalid mode".into());
        }
        let output = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.tmp/render-probe")
            .join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&output)?;
        println!("Output: {}", output.display());
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        let completed = Arc::new(AtomicBool::new(false));
        let builder =
            tauri::Builder::default().invoke_handler(tauri::generate_handler![business_probe]);
        let builder = builder.setup(move |app| {
            if mode == "host" {
                let profile = PathBuf::from(std::env::var_os("STUDIO_RENDER_PROFILE").ok_or("profile required")?);
                WebviewWindowBuilder::new(app, "host-probe", WebviewUrl::App("security-probe.html".into()))
                    .title("响应性验证主窗口").data_directory(profile).visible(false).build()?;
                return Ok(());
            }
            let finished = completed.clone();
            let timeout_app = app.handle().clone();
            std::thread::spawn(move || {std::thread::sleep(Duration::from_secs(30)); if !finished.load(Ordering::Acquire) {eprintln!("RENDER_PROCESS_TIMEOUT"); timeout_app.exit(2);}});
            let mut window = WebviewWindowBuilder::new(app, "render-probe", WebviewUrl::App("render-probe.html".into()))
                .title("无权限 Mermaid 原型").visible(false)
                .on_navigation(|url| url.host_str() == Some("tauri.localhost") && url.path() == "/render-probe.html");
            if let Some(profile) = std::env::var_os("STUDIO_RENDER_PROFILE") {window = window.data_directory(PathBuf::from(profile));}
            let started = AtomicBool::new(false);
            window.on_page_load(move |window, payload| {
                if payload.event() != PageLoadEvent::Finished || started.swap(true, Ordering::AcqRel) {return;}
                let mode = mode.clone();
                let output = output.clone();
                let completed = completed.clone();
                std::thread::spawn(move || {
                    for (index, source) in SOURCES.iter().enumerate().take(if mode == "all" {6} else {1}) {
                        let nonce = uuid::Uuid::new_v4().to_string();
                        let source = if mode == "invalid" {"invalid[".to_string()} else if mode == "oversize" {"a".repeat(102401)} else {(*source).into()};
                        let request = serde_json::json!({"nonce":nonce,"source":source,"stall":mode=="stall"});
                        let invocation = format!("if(window.renderProbe){{void window.renderProbe({request});true}}else{{false}}");
                        let deadline = Instant::now() + Duration::from_secs(8);
                        let mut render_deadline = None;
                        let mut invoked = false;
                        while Instant::now() < deadline {
                            if render_deadline.is_some_and(|deadline| Instant::now() >= deadline) {break;}
                            let (sender, receiver) = std::sync::mpsc::channel();
                            let script = if invoked {"JSON.stringify({result:window.renderProbeResult,ipc:typeof window.__TAURI_INTERNALS__})".to_string()} else {invocation.clone()};
                            window.with_webview(move |platform| {
                                let Ok(webview) = (unsafe {platform.controller().CoreWebView2()}) else {return};
                                let handler = ExecuteScriptCompletedHandler::create(Box::new(move |status, value| {let _=sender.send((status.is_ok(),value)); Ok(())}));
                                let _ = unsafe {webview.ExecuteScript(&HSTRING::from(script), &handler)};
                            }).unwrap();
                            if let Ok((true,value)) = receiver.recv_timeout(Duration::from_millis(500)) {
                                if !invoked {invoked=value=="true"; if invoked {render_deadline=Some(Instant::now()+Duration::from_secs(2));}} else if let Ok(serialized) = serde_json::from_str::<String>(&value) {
                                    let reply:serde_json::Value=serde_json::from_str(&serialized).unwrap();
                                    if reply["result"]["nonce"]==nonce {
                                        if reply["result"]["ipcDenied"]!=true {window.app_handle().exit(3);return;}
                                        fs::write(output.join(format!("result-{index}.json")), serde_json::to_vec_pretty(&reply).unwrap()).unwrap();
                                        println!("RESULT {index}: {}",reply["result"]["error"]);
                                        break;
                                    }
                                }
                            }
                            std::thread::sleep(Duration::from_millis(30));
                        }
                        if !output.join(format!("result-{index}.json")).exists() {eprintln!("RENDER_TIMEOUT");window.app_handle().exit(2); return;}
                    }
                    completed.store(true, Ordering::Release);
                    window.app_handle().exit(0);
                });
            }).build()?;
            Ok(())
        });
        builder.run(context)?;
        Ok(())
    }

    #[tauri::command]
    fn business_probe(window: tauri::WebviewWindow) -> Result<bool, String> {
        if window.label() == "main" {
            Ok(true)
        } else {
            Err("UNAUTHORIZED_WEBVIEW".into())
        }
    }
}

#[cfg(windows)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    native::run()
}
#[cfg(not(windows))]
fn main() {
    eprintln!("Windows only")
}
