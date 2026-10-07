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

const DEFAULT_ICON_BYTES: &[u8] = include_bytes!("../icons/icon.png");
const TERRACOTTA_ICON_BYTES: &[u8] = include_bytes!("../icons/terracotta.png");

#[tauri::command]
fn set_app_icon(app: tauri::AppHandle, icon_name: String) -> Result<String, String> {
    let window = app.get_webview_window("main").ok_or_else(|| "No main window".to_string())?;
    let bytes = match icon_name.to_lowercase().as_str() {
        "terracotta" => TERRACOTTA_ICON_BYTES,
        _ => DEFAULT_ICON_BYTES,
    };
    let img = tauri::image::Image::from_bytes(bytes).map_err(|e| format!("Failed to parse icon: {}", e))?;
    window.set_icon(img).map_err(|e| format!("Failed to set window icon: {}", e))?;
    Ok(icon_name)
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

// ---------------------------------------------------------------------------
// "Back to app" — floating button injection + way-to-app interception.
//
// The main webview loads three kinds of pages: the bundled app, first-party
// remote pages (accounts/auth, opened for SSO) and third-party sites opened
// in-window (room/chat). They share no markup, so the button cannot live in a
// Svelte layout: it is injected as a Tauri init script, which lands in every
// main-frame document before any page script runs. The on_navigation hook is
// the one layer that sees every navigation attempt — including ones no click
// handler would catch — so links to the marketing site or the web app are
// cancelled there and turned into a jump back to the bundled app instead of
// loading the site in the app's window.
// ---------------------------------------------------------------------------

/// Where the webview started — the bundled app. Recorded at setup and from
/// the first local navigation, so dev (`http://localhost:1420`) and production
/// (`http://tauri.localhost` on Windows, `tauri://localhost` elsewhere) all
/// resolve without hardcoding a scheme. Mutex<Option<..>> because plugin setup
/// runs before the window exists and on_navigation may fire before `.setup()`.
static APP_HOME: Mutex<Option<String>> = Mutex::new(None);
static APP_HANDLE: Mutex<Option<AppHandle>> = Mutex::new(None);

fn is_app_origin(url: &tauri::Url) -> bool {
    url.scheme() == "tauri"
        || matches!(
            url.host_str().unwrap_or(""),
            "tauri.localhost" | "localhost" | "127.0.0.1"
        )
}

/// Remember the FIRST local URL as the app's home. Later local hard loads
/// must not overwrite it — home is where the window started.
fn record_app_home(url: &tauri::Url) {
    if !is_app_origin(url) {
        return;
    }
    let mut home = APP_HOME.lock().unwrap_or_else(|e| e.into_inner());
    if home.is_none() {
        *home = Some(url.to_string());
    }
}

/// A way-to-app navigation was cancelled; bring the webview back to the
/// bundled app instead. Deferred through `run_on_main_thread` because
/// on_navigation runs inside WebView2's navigation-policy callback, where
/// re-entering `navigate` would re-enter the webview mid-decision.
fn go_back_to_app() {
    let home = APP_HOME.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let handle = APP_HANDLE.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let (home, handle) = match (home, handle) {
        (Some(h), Some(w)) => (h, w),
        _ => return,
    };
    let Ok(url) = tauri::Url::parse(&home) else { return };
    let nav_handle = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        if let Some(w) = nav_handle.get_webview_window("main") {
            let _ = w.navigate(url);
        }
    });
}

/// Floating "Back to app" pill, injected into every main-frame page the
/// webview shows. Hidden on core app routes (they render the header, whose
/// logo already links home); shown on the header-less app routes and on every
/// remote/third-party page. Styled through CSSOM, not a <style> element or
/// style attribute, so strict remote-page CSPs (`style-src` without
/// `unsafe-inline`) cannot strip it. The click goes to the app's web URL when
/// the current page is remote — the on_navigation hook catches that and
/// redirects it to the bundled app, so the site itself never loads.
const BACK_TO_APP_JS: &str = r#"
(function () {
  if (window.top !== window) return;

  var WAY_TO_APP = 'https://beta.getmaterio.app/';
  // Local routes that already render the app header (whose logo links home)
  // get no button; every header-less route and every remote/third-party page
  // does.
  var NON_CORE = ['/pricing', '/interviewer', '/downloads'];

  function isLocalShell() {
    return (
      location.protocol === 'tauri:' ||
      location.hostname === 'tauri.localhost' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1'
    );
  }

  function wantsButton() {
    if (!isLocalShell()) return true;
    // Prefix match mirrors the layout's startsWith() header-hiding checks so
    // the button's visibility tracks the header (and its logo → home) exactly.
    var path = location.pathname;
    for (var i = 0; i < NON_CORE.length; i++) {
      if (path.indexOf(NON_CORE[i]) === 0) return true;
    }
    return false;
  }

  var button = null;

  function build() {
    var b = document.createElement('button');
    b.type = 'button';
    b.title = 'Back to the Materio app';
    b.setAttribute('aria-label', 'Back to app');
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '13');
    svg.setAttribute('height', '13');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M3 10.8 12 3.5l9 7.3M5.5 9.6V20.5h13V9.6');
    svg.appendChild(path);
    var label = document.createElement('span');
    label.textContent = 'Back to app';
    b.appendChild(svg);
    b.appendChild(label);
    var s = b.style;
    s.position = 'fixed';
    s.right = '14px';
    s.bottom = '14px';
    s.zIndex = '2147483647';
    s.display = 'inline-flex';
    s.alignItems = 'center';
    s.gap = '6px';
    s.margin = '0';
    s.padding = '7px 13px 7px 11px';
    s.borderRadius = '999px';
    s.background = 'rgba(28, 26, 25, 0.92)';
    s.color = '#fafaf9';
    s.border = '1px solid rgba(255, 255, 255, 0.18)';
    s.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.35)';
    s.backdropFilter = 'blur(8px)';
    s.fontFamily = 'system-ui, -apple-system, sans-serif';
    s.fontSize = '12px';
    s.fontWeight = '600';
    s.lineHeight = '1';
    s.cursor = 'pointer';
    s.opacity = '0.9';
    s.transition = 'opacity 120ms ease';
    b.addEventListener('mouseenter', function () { s.opacity = '1'; });
    b.addEventListener('mouseleave', function () { s.opacity = '0.9'; });
    b.addEventListener('click', function () {
      // Inside the bundled app this is a plain trip home. On remote or
      // third-party pages it navigates to the app's web URL, which the
      // shell's on_navigation hook catches and turns into a jump back to
      // the bundled app — the site itself is never opened.
      location.href = isLocalShell() ? '/' : WAY_TO_APP;
    });
    return b;
  }

  function apply() {
    try {
      if (wantsButton()) {
        if (!button) button = build();
        if (!button.isConnected) {
          (document.body || document.documentElement).appendChild(button);
        }
      } else if (button && button.isConnected) {
        button.parentNode.removeChild(button);
      }
    } catch (e) {}
  }

  // The app is an SPA: client-side route changes do not reload the document,
  // so re-evaluate whenever history mutates. Wrapping (rather than listening
  // only for popstate) also covers routers that captured these functions
  // before this script ran — impossible here, since init scripts run first,
  // but harmless either way.
  try {
    var push = history.pushState;
    history.pushState = function () {
      var r = push.apply(this, arguments);
      apply();
      return r;
    };
    var replace = history.replaceState;
    history.replaceState = function () {
      var r = replace.apply(this, arguments);
      apply();
      return r;
    };
    window.addEventListener('popstate', apply);
    window.addEventListener('hashchange', apply);
  } catch (e) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
})();
"#;

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
            annot_diag,
            set_app_icon
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
        // Back-to-app: inject the floating button into every main-frame page
        // the webview loads, and turn navigations to getmaterio.app /
        // beta.getmaterio.app into a return to the bundled app — those are
        // "the way to app", not sites to open inside the app's window.
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("materio-shell")
                .js_init_script(BACK_TO_APP_JS)
                .on_navigation(|_webview, url| {
                    let host = url.host_str().unwrap_or("");
                    if matches!(
                        host,
                        "getmaterio.app" | "www.getmaterio.app" | "beta.getmaterio.app"
                    ) {
                        go_back_to_app();
                        return false;
                    }
                    record_app_home(url);
                    true
                })
                .build(),
        )
        .setup(|app| {
            // Capture the handle the way-to-app redirect needs. Plugin setup
            // runs before windows exist, so this is the earliest point that
            // can pair the handle with the main window; no blocklisted
            // navigation can fire before this closure completes.
            *APP_HANDLE.lock().unwrap_or_else(|e| e.into_inner()) = Some(app.handle().clone());
            // Record where the main webview started (the bundled app) — the
            // redirect target for intercepted way-to-app navigations;
            // on_navigation's first local load is the backup.
            if let Some(w) = app.get_webview_window("main") {
                if let Ok(u) = w.url() {
                    record_app_home(&u);
                }
            }
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
