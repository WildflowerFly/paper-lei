#[cfg(windows)]
mod native {
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicBool, Ordering},
        time::Duration,
    };
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, webview::PageLoadEvent};
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, PrintToPdfCompletedHandler};
    use windows_core::{HSTRING, Interface};

    fn execute(
        platform: tauri::webview::PlatformWebview,
        app: tauri::AppHandle,
        mode: &str,
        directory: PathBuf,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let webview = unsafe { platform.controller().CoreWebView2()? };
        if mode == "print" {
            let printing: ICoreWebView2_16 = webview.cast()?;
            unsafe { printing.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM)? };
            println!("PRINT_UI_REQUESTED: close the dialog without submitting a job");
            return Ok(());
        }
        let printer: ICoreWebView2_7 = webview.cast()?;
        let environment: ICoreWebView2Environment6 = platform.environment().cast()?;
        let settings = unsafe { environment.CreatePrintSettings()? };
        unsafe {
            settings.SetPageWidth(210.0 / 25.4)?;
            settings.SetPageHeight(297.0 / 25.4)?;
            settings.SetMarginTop(16.0 / 25.4)?;
            settings.SetMarginBottom(16.0 / 25.4)?;
            settings.SetMarginLeft(16.0 / 25.4)?;
            settings.SetMarginRight(16.0 / 25.4)?;
            settings.SetShouldPrintHeaderAndFooter(false)?;
            settings.SetShouldPrintBackgrounds(true)?;
        }
        let temporary = if mode == "fail" {
            directory.join("missing").join("result.pdf")
        } else {
            directory.join("temporary.pdf")
        };
        let path = HSTRING::from(temporary.as_os_str());
        let cancelled = std::rc::Rc::new(std::cell::Cell::new(false));
        let cancellation = cancelled.clone();
        let callback = PrintToPdfCompletedHandler::create(Box::new(move |status, success| {
            let outcome = if cancellation.get() {
                match fs::remove_file(&temporary) {
                    Ok(()) => true,
                    Err(error) => error.kind() == std::io::ErrorKind::NotFound,
                }
                .then_some("CANCELLED")
            } else if status.is_ok()
                && success
                && fs::read(&temporary).is_ok_and(|bytes| bytes.starts_with(b"%PDF-"))
            {
                fs::rename(&temporary, directory.join("sample.pdf"))
                    .is_ok()
                    .then_some("COMPLETED")
            } else {
                None
            };
            println!("{}", outcome.unwrap_or("EXPORT_FAILED"));
            app.exit(if outcome.is_some() { 0 } else { 1 });
            Ok(())
        }));
        unsafe { printer.PrintToPdf(&path, &settings, &callback)? };
        if mode == "cancel" {
            cancelled.set(true);
        }
        Ok(())
    }

    pub fn run() -> Result<(), Box<dyn std::error::Error>> {
        let mode = std::env::args().nth(1).unwrap_or_else(|| "pdf".into());
        if !["pdf", "fail", "cancel", "print"].contains(&mode.as_str()) {
            return Err("expected pdf, fail, cancel or print".into());
        }
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.tmp/print-probe")
            .join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&directory)?;
        println!("Probe output: {}", directory.display());
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        tauri::Builder::default()
            .register_uri_scheme_protocol("printprobe", |_, request| {
                let found = request.uri().path() == "/sample";
                tauri::http::Response::builder().status(if found { 200 } else { 404 })
                    .header("Content-Type", "text/html; charset=utf-8")
                    .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
                    .body(if found { include_bytes!("../../tests/fixtures/print-sample.html").as_slice() } else { &[] }).unwrap()
            })
            .setup(move |app| {
                let url: tauri::Url = "http://printprobe.localhost/sample".parse()?;
                let started = AtomicBool::new(false);
                let timeout = app.handle().clone();
                if mode != "print" { std::thread::spawn(move || {std::thread::sleep(Duration::from_secs(45)); eprintln!("EXPORT_TIMEOUT"); timeout.exit(2);}); }
                WebviewWindowBuilder::new(app, "print-probe", WebviewUrl::External(url.clone()))
                    .title("Markdown Studio · 原生打印验证").disable_javascript()
                    .on_navigation(move |location| *location == url)
                    .on_page_load(move |window, payload| {
                        if payload.event() != PageLoadEvent::Finished || payload.url().path() != "/sample" || started.swap(true, Ordering::AcqRel) { return; }
                        let handle = window.app_handle().clone();
                        let mode = mode.clone();
                        let directory = directory.clone();
                        let result = window.with_webview(move |platform| {
                            if let Err(error) = execute(platform, handle.clone(), &mode, directory) {
                                eprintln!("EXPORT_FAILED: {error}"); handle.exit(1);
                            }
                        });
                        if result.is_err() { window.app_handle().exit(1); }
                    }).build()?;
                Ok(())
            }).run(context)?;
        Ok(())
    }
}

#[cfg(windows)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    native::run()
}

#[cfg(not(windows))]
fn main() {
    eprintln!("This prototype requires Windows WebView2.");
}
