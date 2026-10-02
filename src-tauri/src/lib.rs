use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct McpServerState {
    process: Mutex<Option<Child>>,
}

#[tauri::command]
fn start_mcp_server(app: AppHandle, state: State<'_, McpServerState>) -> Result<String, String> {
    let mut lock = state.process.lock().map_err(|e| e.to_string())?;

    // Check if already running via child process
    if let Some(ref mut child) = *lock {
        match child.try_wait() {
            Ok(None) => return Ok("MCP server is already running".to_string()),
            _ => {
                *lock = None;
            }
        }
    }

    // Check if MCP server is already listening on port 3000
    if std::net::TcpStream::connect("127.0.0.1:3000").is_ok() {
        return Ok("MCP server is already running on http://localhost:3000/mcp".to_string());
    }

    // Resolve resource and execution paths
    let resource_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());

    let mut exe_candidates = vec![
        // Production: bundled as a resource directly in resource_dir
        resource_dir.join("materio-mcp.exe"),
        resource_dir.join("mcp").join("materio-mcp.exe"),
        resource_dir.join("resources").join("mcp").join("materio-mcp.exe"),
        resource_dir.join("_up_").join("mcp").join("materio-mcp.exe"),
    ];

    if let Ok(cur) = std::env::current_dir() {
        // Development: binary is in the mcp folder relative to the project
        exe_candidates.push(cur.join("mcp").join("materio-mcp.exe"));
        exe_candidates.push(cur.join("svelte").join("mcp").join("materio-mcp.exe"));
        exe_candidates.push(cur.join("../mcp").join("materio-mcp.exe"));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            exe_candidates.push(exe_dir.join("materio-mcp.exe"));
            exe_candidates.push(exe_dir.join("mcp").join("materio-mcp.exe"));
            exe_candidates.push(exe_dir.join("resources").join("materio-mcp.exe"));
            exe_candidates.push(exe_dir.join("resources").join("mcp").join("materio-mcp.exe"));
            exe_candidates.push(exe_dir.join("_up_").join("mcp").join("materio-mcp.exe"));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut unix_candidates = Vec::new();
        for p in &exe_candidates {
            if let Some(parent) = p.parent() {
                unix_candidates.push(parent.join("materio-mcp"));
            }
        }
        exe_candidates.extend(unix_candidates);
    }

    let standalone_bin = exe_candidates.into_iter().find(|p| p.exists());

    let mut cmd = if let Some(bin_path) = standalone_bin {
        let work_dir = bin_path.parent().unwrap_or_else(|| std::path::Path::new("."));
        let mut c = Command::new(&bin_path);
        #[cfg(target_os = "windows")]
        c.creation_flags(CREATE_NO_WINDOW);
        c.current_dir(work_dir);
        c
    } else {
        // Fallback to npx/bun in development mode
        let mut dir_candidates = vec![
            resource_dir.join("mcp"),
            resource_dir.join("_up_").join("mcp"),
            resource_dir.join("../mcp"),
        ];
        if let Ok(cur) = std::env::current_dir() {
            dir_candidates.push(cur.join("mcp"));
            dir_candidates.push(cur.join("svelte/mcp"));
            dir_candidates.push(cur.join("../mcp"));
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                dir_candidates.push(exe_dir.join("mcp"));
                dir_candidates.push(exe_dir.join("resources/mcp"));
            }
        }
        let working_dir = dir_candidates
            .into_iter()
            .find(|p| p.join("src/index.ts").exists() || p.join("package.json").exists())
            .unwrap_or_else(|| std::path::PathBuf::from("mcp"));

        #[cfg(target_os = "windows")]
        {
            let mut c = Command::new("cmd");
            c.creation_flags(CREATE_NO_WINDOW);
            c.args(&["/C", "npx --yes tsx src/index.ts"]);
            c.current_dir(&working_dir);
            c
        }
        #[cfg(not(target_os = "windows"))]
        {
            let mut c = Command::new("npx");
            c.args(&["--yes", "tsx", "src/index.ts"]);
            c.current_dir(&working_dir);
            c
        }
    };

    cmd.env("PORT", "3000")
        .env("TRANSPORT", "http")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    match cmd.spawn() {
        Ok(child) => {
            *lock = Some(child);
            Ok("MCP server started on http://localhost:3000/mcp".to_string())
        }
        Err(e) => Err(format!("Failed to start MCP server: {}", e)),
    }
}

#[tauri::command]
fn stop_mcp_server(state: State<'_, McpServerState>) -> Result<String, String> {
    let mut lock = state.process.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = lock.take() {
        let _ = child.kill();
        let _ = child.wait();
        Ok("MCP server stopped".to_string())
    } else {
        Ok("MCP server was not running".to_string())
    }
}

#[tauri::command]
fn get_mcp_status(state: State<'_, McpServerState>) -> Result<bool, String> {
    let mut lock = state.process.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut child) = *lock {
        match child.try_wait() {
            Ok(None) => return Ok(true), // Process is active
            _ => {
                *lock = None;
            }
        }
    }

    // Also check if port 3000 is listening
    if std::net::TcpStream::connect("127.0.0.1:3000").is_ok() {
        return Ok(true);
    }

    Ok(false)
}

#[tauri::command]
async fn install_update_and_restart(
    app: AppHandle,
    download_url: Option<String>,
    expected_version: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;

        let url = download_url.unwrap_or_else(|| {
            "https://getmaterio.app/api/download/windows".to_string()
        });

        // Guard against stale/wrong payloads (a cached "latest" response
        // would otherwise silently DOWNGRADE the app): the download URL
        // must name the expected release.
        if let Some(expected) = expected_version
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let norm = expected.trim_start_matches(['v', 'V']);
            let with_v = format!("v{}", norm);
            if !(url.contains(norm) || url.contains(&with_v)) {
                return Err(format!(
                    "Update URL does not match expected version {}: {}",
                    expected, url
                ));
            }
        }

        let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let current_exe_str = current_exe.to_string_lossy().to_string();
        let current_pid = std::process::id();

        let temp_dir = std::env::temp_dir();
        let target_installer = temp_dir.join("Materio-Update-Setup.exe");
        let target_installer_str = target_installer.to_string_lossy().to_string();
        let updater_bat = temp_dir.join("materio-update-runner.bat");
        let updater_bat_str = updater_bat.to_string_lossy().to_string();

        // Drop any leftover installer from a previous run so a failed
        // download can never install a stale binary (downgrade).
        let _ = std::fs::remove_file(&target_installer);

        log::info!("Downloading update from: {} to: {}", url, target_installer_str);

        // Try downloading via curl.exe (built-in on Windows 10/11).
        // BOUNDED: --connect-timeout / --max-time stop this hanging for
        // minutes on an unreachable host. Previously there was no time limit
        // at all, so a blocked/slow GitHub asset produced a multi-minute
        // freeze with no output before finally giving up.
        let mut download_ok = false;
        let mut curl_detail = String::new();
        let curl_res = Command::new("curl.exe")
            .creation_flags(CREATE_NO_WINDOW)
            .args(&[
                "-fSL",
                "--connect-timeout",
                "20",
                "--max-time",
                "600",
                "--retry",
                "2",
                "--retry-delay",
                "3",
                &url,
                "-o",
                &target_installer_str,
            ])
            .status();

        if let Ok(status) = curl_res {
            if status.success() && target_installer.exists() {
                download_ok = true;
            } else {
                curl_detail = format!(
                    "curl exit {:?}{}",
                    status.code(),
                    target_installer
                        .metadata()
                        .map(|m| format!(" ({} bytes written)", m.len()))
                        .unwrap_or_default()
                );
            }
        } else {
            curl_detail = "curl could not be started".to_string();
        }

        // Fallback to powershell if curl failed
        if !download_ok {
            let ps_script = format!(
                "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $wc = New-Object System.Net.WebClient; $wc.DownloadFile('{}', '{}')",
                url.replace('\'', "''"), target_installer_str.replace('\'', "''")
            );
            let ps_res = Command::new("powershell")
                .creation_flags(CREATE_NO_WINDOW)
                .args(&["-NoProfile", "-NonInteractive", "-Command", &ps_script])
                .status();
            if let Ok(status) = ps_res {
                if status.success() && target_installer.exists() {
                    download_ok = true;
                } else {
                    let detail = format!("powershell exit {:?}", status.code());
                    curl_detail = if curl_detail.is_empty() {
                        detail
                    } else {
                        format!("{}; {}", curl_detail, detail)
                    };
                }
            } else {
                let detail = "powershell could not be started".to_string();
                curl_detail = if curl_detail.is_empty() {
                    detail
                } else {
                    format!("{}; {}", curl_detail, detail)
                };
            }
        }

        if !download_ok {
            // Report WHY, not just that it failed. This string is surfaced in
            // the app UI, so include the download URL for diagnosis.
            return Err(format!(
                "Failed to download the installer from {} ({})",
                url, curl_detail
            ));
        }

        // Sanity: the real NSIS setup is ~80MB. Anything drastically
        // smaller is an error page / truncated file — installing it would
        // silently fail and leave (or revert) the app version.
        const MIN_INSTALLER_BYTES: u64 = 20_000_000;
        match std::fs::metadata(&target_installer) {
            Ok(meta) if meta.len() >= MIN_INSTALLER_BYTES => {
                log::info!("Update installer verified: {} bytes", meta.len());
            }
            other => {
                let _ = std::fs::remove_file(&target_installer);
                return Err(format!(
                    "Downloaded installer looks invalid ({}).",
                    match other {
                        Ok(meta) => format!("only {} bytes", meta.len()),
                        Err(e) => format!("unreadable: {}", e),
                    }
                ));
            }
        }

        log::info!("Update downloaded. Writing updater script and exiting app for update...");

        // Batch script to:
        // 1. Wait for current Materio process to exit completely
        // 2. Run the NSIS installer silently (/S) to update files
        // 3. Restart the newly installed Materio application
        // 4. Clean up temporary installer
        let bat_content = format!(
            "@echo off\r\n\
            :wait_loop\r\n\
            tasklist /fi \"PID eq {pid}\" 2>nul | find \"{pid}\" >nul\r\n\
            if not errorlevel 1 (\r\n\
                timeout /t 1 /nobreak >nul\r\n\
                goto wait_loop\r\n\
            )\r\n\
            timeout /t 2 /nobreak >nul\r\n\
            start /wait \"\" \"{installer}\" /S\r\n\
            timeout /t 2 /nobreak >nul\r\n\
            if exist \"{exe}\" (\r\n\
                start \"\" \"{exe}\"\r\n\
            ) else if exist \"%LOCALAPPDATA%\\Programs\\Materio\\Materio.exe\" (\r\n\
                start \"\" \"%LOCALAPPDATA%\\Programs\\Materio\\Materio.exe\"\r\n\
            ) else if exist \"%ProgramFiles%\\Materio\\Materio.exe\" (\r\n\
                start \"\" \"%ProgramFiles%\\Materio\\Materio.exe\"\r\n\
            )\r\n\
            rem Force-delete the downloaded installer. A plain del silently\r\n\
            rem fails while the file is still locked, which is how a 78MB\r\n\
            rem installer was left sitting in TEMP after a successful update.\r\n\
            :cleanup_loop\r\n\
            del /f /q \"{installer}\" >nul 2>&1\r\n\
            if exist \"{installer}\" (\r\n\
                timeout /t 2 /nobreak >nul\r\n\
                goto cleanup_loop\r\n\
            )\r\n\
            (goto) 2>nul & del \"%~f0\" 2>nul & exit\r\n",
            pid = current_pid,
            installer = target_installer_str,
            exe = current_exe_str
        );

        if let Err(e) = std::fs::write(&updater_bat, bat_content) {
            return Err(format!("Failed to write updater script: {}", e));
        }

        // Launch the detached batch script
        let _ = Command::new("cmd.exe")
            .creation_flags(CREATE_NO_WINDOW)
            .args(&["/C", "start", "", "/B", &updater_bat_str])
            .spawn();

        // Kill MCP child process if running so file locks are cleared
        if let Some(state) = app.try_state::<McpServerState>() {
            if let Ok(mut lock) = state.process.lock() {
                if let Some(mut child) = lock.take() {
                    let _ = child.kill();
                }
            }
        }

        // Hard-exit rather than app.exit(0).
        //
        // app.exit(0) requests a GRACEFUL shutdown, which must be serviced by
        // the event loop — but this command blocks that loop for the entire
        // download (Command::status() is synchronous), so the graceful exit
        // never completed. The detached updater script was left polling
        // `tasklist` for this PID forever: the app appeared frozen on
        // "Updating and Restarting" and only installed once the user closed it
        // manually. Evidence: the installer had fully downloaded (78MB, valid
        // v2.1.90 PE) yet the app was still on the old build until closed by
        // hand, and the installer was left behind because the script's `del`
        // ran while the file was still locked.
        //
        // The installer script handles the actual replacement, so an abrupt
        // exit is safe here. Give the detached script a moment to start first.
        let _ = app;
        std::thread::sleep(std::time::Duration::from_millis(400));
        std::process::exit(0);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = download_url;
        Err("In-app restart is currently supported on Windows".to_string())
    }
}

#[tauri::command]
fn app_window_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn app_window_toggle_maximize(window: tauri::Window) {
    if let Ok(is_max) = window.is_maximized() {
        if is_max {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
fn app_window_close(window: tauri::Window) {
    let _ = window.close();
}

#[tauri::command]
fn app_window_is_maximized(window: tauri::Window) -> bool {
    window.is_maximized().unwrap_or(false)
}

/// Appends one diagnostic line to the app log file.
///
/// Exists because tauri-plugin-log's Webview target only forwards calls made
/// through its own JS API, and that package is not installed here — so raw
/// `console.log` from the app (and from the PDF viewer iframe, which has no
/// devtools in a packaged build) never reaches the log file. That made a failing
/// PDF annotation restore completely undiagnosable: the whole failure path is JS
/// and none of it was persisted.
///
/// Called from JS via `window.__TAURI__.core.invoke`, same transport as
/// `open_external_url`.
#[tauri::command]
fn annot_diag(app: tauri::AppHandle, line: String) {
    let clean: String = line
        .chars()
        .filter(|c| *c != '\n' && *c != '\r')
        .take(4000)
        .collect();
    if let Some(dir) = app.path().app_log_dir().ok() {
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("annot-diag.log");
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let _ = writeln!(f, "[{}] {}", stamp, clean);
        }
    }
}

/// Opens an off-app link in the OS default browser (room posts, status
/// page, share URLs, …). The desktop WebView ships no opener plugin, so
/// plain target=_blank links would otherwise do nothing. Only http(s)
/// URLs are allowed — everything else is rejected.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let u = url.trim();
    if !(u.starts_with("https://") || u.starts_with("http://")) {
        return Err("Only http(s) URLs may be opened externally".to_string());
    }
    open::that(u).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(McpServerState {
            process: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            start_mcp_server,
            stop_mcp_server,
            get_mcp_status,
            install_update_and_restart,
            app_window_minimize,
            app_window_toggle_maximize,
            app_window_close,
            app_window_is_maximized,
            open_external_url,
            annot_diag
        ])
        // Second launches (e.g. materio:// taps from the browser while the
        // app runs) focus the existing window and forward the URL instead
        // of opening a duplicate window.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
                for arg in args.iter().skip(1) {
                    if arg.starts_with("materio://")
                        || arg.starts_with("https://getmaterio.app")
                        || arg.starts_with("http://getmaterio.app")
                    {
                        let js = format!("if (typeof window.__materioHandleDeepLink === 'function') {{ window.__materioHandleDeepLink('{}'); }}", arg.replace('\'', "\\'"));
                        let _ = w.eval(&js);
                        break;
                    }
                }
            }
        }))
        .setup(|app| {
            // Logging was registered ONLY in debug builds, which meant every
            // log::info!/warn! in the updater was discarded in shipped
            // releases. A failed auto-update was therefore completely
            // undiagnosable — the app just silently fell back to /downloads.
            // Register it in release too, writing to a log file under the
            // app's log directory so failures can actually be read.
            let handle = app.handle().clone();
            let mut builder = tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info);
            // Forward the WebView's console.* into the same log file. Without
            // this only Rust-side macros were persisted, so anything logged from
            // JS — the viewer runs in an iframe and has no devtools in a
            // packaged app — vanished. That is why a failing PDF annotation
            // restore was undiagnosable: the whole failure path is JS.
            builder = builder.target(tauri_plugin_log::Target::new(
                tauri_plugin_log::TargetKind::Webview,
            ));
            let file_target = handle.path().app_log_dir().ok().map(|dir| {
                let _ = std::fs::create_dir_all(&dir);
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                    path: dir,
                    file_name: None,
                })
            });
            builder = match file_target {
                Some(t) => builder.target(t),
                None => builder.target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                )),
            };
            handle.plugin(builder.build())?;
            let _ = &handle;

            // MCP server starts OFF by default. It will only be launched
            // when explicitly triggered by the user via start_mcp_server command.

            // Handle launch arguments for associated links (materio:// or web URLs)
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                std::thread::sleep(std::time::Duration::from_millis(600));
                for arg in std::env::args().skip(1) {
                    if arg.starts_with("materio://") || arg.starts_with("https://getmaterio.app") || arg.starts_with("http://getmaterio.app") {
                        if let Some(w) = handle.get_webview_window("main") {
                            let js = format!("if (typeof window.__materioHandleDeepLink === 'function') {{ window.__materioHandleDeepLink('{}'); }}", arg.replace('\'', "\\'"));
                            let _ = w.eval(&js);
                        }
                        break;
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Ensure MCP child process is killed when the last window is closed
                if let Some(state) = window.try_state::<McpServerState>() {
                    if let Ok(mut lock) = state.process.lock() {
                        if let Some(mut child) = lock.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
