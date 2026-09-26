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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(McpServerState {
            process: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            start_mcp_server,
            stop_mcp_server,
            get_mcp_status
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Automatically launch local MCP server in background on app startup
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Some(state) = app_handle.try_state::<McpServerState>() {
                    let _ = start_mcp_server(app_handle.clone(), state);
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
