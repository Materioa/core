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

    // Check if already running
    if let Some(ref mut child) = *lock {
        match child.try_wait() {
            Ok(None) => return Ok("MCP server is already running".to_string()),
            _ => {
                *lock = None;
            }
        }
    }

    // Resolve project/resource root
    let resource_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());

    // Check possible MCP paths:
    // 1. Sibling "mcp" directory in dev:
    let candidate_dev = resource_dir.join("../mcp");
    // 2. Subdirectory "mcp" in bundled resources:
    let candidate_bundle = resource_dir.join("mcp");

    let working_dir = if candidate_dev.exists() {
        candidate_dev
    } else if candidate_bundle.exists() {
        candidate_bundle
    } else {
        std::path::PathBuf::from("mcp")
    };

    #[cfg(target_os = "windows")]
    let mut cmd = Command::new("cmd");
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.args(&["/C", "npx tsx src/index.ts"]);
    }

    #[cfg(not(target_os = "windows"))]
    let mut cmd = Command::new("npx");
    #[cfg(not(target_os = "windows"))]
    {
        cmd.args(&["tsx", "src/index.ts"]);
    }

    cmd.current_dir(&working_dir)
        .env("PORT", "3000")
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
            Ok(None) => Ok(true), // Process is active
            _ => {
                *lock = None;
                Ok(false)
            }
        }
    } else {
        Ok(false)
    }
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
