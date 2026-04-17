use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::Mutex,
};
use tauri::{AppHandle, State};

#[derive(Debug, Deserialize)]
struct BackendRequest {
    method: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Debug, Serialize)]
struct BackendLineRequest<'a> {
    id: u64,
    method: &'a str,
    payload: &'a Value,
}

#[derive(Debug, Deserialize)]
struct BackendLineResponse {
    id: u64,
    ok: bool,
    #[serde(default)]
    result: Value,
    #[serde(default)]
    error: String,
}

struct BackendProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl Drop for BackendProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct BackendState {
    process: Mutex<Option<BackendProcess>>,
}

fn backend_entry() -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().map_err(|err| err.to_string())?;
    let candidates = [
        cwd.join("src/renderers/tauri/backend/main.ts"),
        cwd.join("../src/renderers/tauri/backend/main.ts"),
    ];
    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| "Could not locate Tauri backend entrypoint.".to_string())
}

fn spawn_backend() -> Result<BackendProcess, String> {
    let entry = backend_entry()?;
    let mut child = Command::new("bun")
        .arg(entry)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|err| format!("Failed to spawn Bun backend: {err}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Backend stdin was unavailable.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Backend stdout was unavailable.".to_string())?;

    Ok(BackendProcess {
        child,
        stdin,
        stdout: BufReader::new(stdout),
        next_id: 1,
    })
}

fn backend_request(state: &BackendState, method: &str, payload: &Value) -> Result<Value, String> {
    let mut process_guard = state
        .process
        .lock()
        .map_err(|_| "Backend process lock was poisoned.".to_string())?;

    if process_guard.is_none() {
        *process_guard = Some(spawn_backend()?);
    }

    let process = process_guard.as_mut().unwrap();
    let id = process.next_id;
    process.next_id += 1;

    let line = serde_json::to_string(&BackendLineRequest {
        id,
        method,
        payload,
    })
    .map_err(|err| err.to_string())?;

    process
        .stdin
        .write_all(line.as_bytes())
        .and_then(|_| process.stdin.write_all(b"\n"))
        .and_then(|_| process.stdin.flush())
        .map_err(|err| format!("Failed to write backend request: {err}"))?;

    let mut response_line = String::new();
    process
        .stdout
        .read_line(&mut response_line)
        .map_err(|err| format!("Failed to read backend response: {err}"))?;
    if response_line.trim().is_empty() {
        return Err("Backend exited without a response.".to_string());
    }

    let response: BackendLineResponse =
        serde_json::from_str(&response_line).map_err(|err| format!("Invalid backend response: {err}"))?;
    if response.id != id {
        return Err(format!("Backend response id mismatch: expected {id}, got {}", response.id));
    }
    if response.ok {
        Ok(response.result)
    } else {
        Err(response.error)
    }
}

fn open_external(url: &str) -> Result<Value, String> {
    if url.trim().is_empty() {
        return Ok(Value::Null);
    }
    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg(url).status()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", url]).status()
    } else {
        Command::new("xdg-open").arg(url).status()
    }
    .map_err(|err| err.to_string())?;

    if status.success() {
        Ok(Value::Null)
    } else {
        Err(format!("open command exited with {status}"))
    }
}

fn copy_text(text: &str) -> Result<Value, String> {
    if cfg!(target_os = "macos") {
        let mut child = Command::new("pbcopy")
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|err| err.to_string())?;
        child
            .stdin
            .take()
            .ok_or_else(|| "pbcopy stdin was unavailable.".to_string())?
            .write_all(text.as_bytes())
            .map_err(|err| err.to_string())?;
        let status = child.wait().map_err(|err| err.to_string())?;
        return if status.success() { Ok(Value::Null) } else { Err(format!("pbcopy exited with {status}")) };
    }
    Err("Clipboard copy is not implemented for this platform yet.".to_string())
}

fn read_text() -> Result<Value, String> {
    if cfg!(target_os = "macos") {
        let output = Command::new("pbpaste").output().map_err(|err| err.to_string())?;
        if output.status.success() {
            return Ok(Value::String(String::from_utf8_lossy(&output.stdout).to_string()));
        }
        return Err(format!("pbpaste exited with {}", output.status));
    }
    Err("Clipboard read is not implemented for this platform yet.".to_string())
}

fn handle_host_request(app: &AppHandle, request: &BackendRequest) -> Option<Result<Value, String>> {
    match request.method.as_str() {
        "host.exit" => {
            app.exit(0);
            Some(Ok(Value::Null))
        }
        "host.openExternal" => Some(open_external(
            request
                .payload
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        )),
        "host.copyText" => Some(copy_text(
            request
                .payload
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        )),
        "host.readText" => Some(read_text()),
        _ => None,
    }
}

#[tauri::command]
fn tauri_backend_request(
    app: AppHandle,
    state: State<'_, BackendState>,
    request: BackendRequest,
) -> Result<Value, String> {
    if let Some(result) = handle_host_request(&app, &request) {
        return result;
    }
    backend_request(&state, &request.method, &request.payload)
}

fn main() {
    tauri::Builder::default()
        .manage(BackendState {
            process: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![tauri_backend_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
