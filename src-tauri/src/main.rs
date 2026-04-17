use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    future::Future,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    pin::Pin,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    task::{Context, Poll, Waker},
    thread,
    time::Instant,
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
}

impl Drop for BackendProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct BackendState {
    client: BackendClient,
}

#[derive(Clone)]
struct BackendClient {
    tx: mpsc::Sender<BackendActorMessage>,
}

struct BackendCommand {
    method: String,
    payload: Value,
    response: AsyncResponseSender,
}

enum BackendActorMessage {
    Request(BackendCommand),
    Response(Result<BackendLineResponse, String>),
    BackendExited(String),
}

struct AsyncResponseState {
    result: Option<Result<Value, String>>,
    waker: Option<Waker>,
}

struct AsyncResponseSender {
    state: Arc<Mutex<AsyncResponseState>>,
}

struct AsyncResponseReceiver {
    state: Arc<Mutex<AsyncResponseState>>,
}

fn async_response_channel() -> (AsyncResponseSender, AsyncResponseReceiver) {
    let state = Arc::new(Mutex::new(AsyncResponseState {
        result: None,
        waker: None,
    }));
    (
        AsyncResponseSender {
            state: Arc::clone(&state),
        },
        AsyncResponseReceiver { state },
    )
}

impl AsyncResponseSender {
    fn send(self, result: Result<Value, String>) {
        let waker = {
            let mut state = self.state.lock().unwrap();
            if state.result.is_some() {
                return;
            }
            state.result = Some(result);
            state.waker.take()
        };
        if let Some(waker) = waker {
            waker.wake();
        }
    }
}

impl Future for AsyncResponseReceiver {
    type Output = Result<Value, String>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let mut state = self.state.lock().unwrap();
        if let Some(result) = state.result.take() {
            Poll::Ready(result)
        } else {
            state.waker = Some(cx.waker().clone());
            Poll::Pending
        }
    }
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

fn read_backend_stdout(stdout: ChildStdout, tx: mpsc::Sender<BackendActorMessage>) {
    let mut reader = BufReader::new(stdout);
    loop {
        let mut response_line = String::new();
        match reader.read_line(&mut response_line) {
            Ok(0) => {
                let _ = tx.send(BackendActorMessage::BackendExited(
                    "Backend exited without a response.".to_string(),
                ));
                return;
            }
            Ok(_) => {
                let response = serde_json::from_str::<BackendLineResponse>(&response_line)
                    .map_err(|err| format!("Invalid backend response: {err}"));
                let _ = tx.send(BackendActorMessage::Response(response));
            }
            Err(err) => {
                let _ = tx.send(BackendActorMessage::BackendExited(format!(
                    "Failed to read backend response: {err}",
                )));
                return;
            }
        }
    }
}

fn spawn_backend(tx: mpsc::Sender<BackendActorMessage>) -> Result<BackendProcess, String> {
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

    thread::spawn(move || read_backend_stdout(stdout, tx));

    Ok(BackendProcess { child, stdin })
}

fn reject_pending(pending: &mut HashMap<u64, AsyncResponseSender>, error: &str) {
    for (_, response) in pending.drain() {
        response.send(Err(error.to_string()));
    }
}

fn deliver_backend_response(
    pending: &mut HashMap<u64, AsyncResponseSender>,
    response: BackendLineResponse,
) -> bool {
    let Some(sender) = pending.remove(&response.id) else {
        return false;
    };
    let result = if response.ok {
        Ok(response.result)
    } else {
        Err(response.error)
    };
    sender.send(result);
    true
}

fn fail_backend(
    process: &mut Option<BackendProcess>,
    pending: &mut HashMap<u64, AsyncResponseSender>,
    error: String,
) {
    reject_pending(pending, &error);
    if let Some(mut existing) = process.take() {
        let _ = existing.child.kill();
        let _ = existing.child.wait();
    }
}

fn run_backend_actor(
    rx: mpsc::Receiver<BackendActorMessage>,
    tx: mpsc::Sender<BackendActorMessage>,
) {
    let mut process: Option<BackendProcess> = None;
    let mut pending: HashMap<u64, AsyncResponseSender> = HashMap::new();
    let mut next_id = 1_u64;

    for message in rx {
        match message {
            BackendActorMessage::Request(command) => {
                if process.is_none() {
                    match spawn_backend(tx.clone()) {
                        Ok(next_process) => {
                            process = Some(next_process);
                        }
                        Err(error) => {
                            let _ = command.response.send(Err(error));
                            continue;
                        }
                    }
                }

                let id = next_id;
                next_id += 1;
                let line = match serde_json::to_string(&BackendLineRequest {
                    id,
                    method: &command.method,
                    payload: &command.payload,
                }) {
                    Ok(line) => line,
                    Err(error) => {
                        let _ = command.response.send(Err(error.to_string()));
                        continue;
                    }
                };

                let write_result = if let Some(existing) = process.as_mut() {
                    existing
                        .stdin
                        .write_all(line.as_bytes())
                        .and_then(|_| existing.stdin.write_all(b"\n"))
                        .and_then(|_| existing.stdin.flush())
                } else {
                    Err(std::io::Error::new(
                        std::io::ErrorKind::BrokenPipe,
                        "backend process missing",
                    ))
                };

                if let Err(error) = write_result {
                    let message = format!("Failed to write backend request: {error}");
                    let _ = command.response.send(Err(message.clone()));
                    fail_backend(&mut process, &mut pending, message);
                    continue;
                }

                pending.insert(id, command.response);
            }
            BackendActorMessage::Response(response) => match response {
                Ok(response) => {
                    deliver_backend_response(&mut pending, response);
                }
                Err(error) => {
                    fail_backend(&mut process, &mut pending, error);
                }
            },
            BackendActorMessage::BackendExited(error) => {
                fail_backend(&mut process, &mut pending, error);
            }
        }
    }
}

fn create_backend_client() -> BackendClient {
    let (tx, rx) = mpsc::channel::<BackendActorMessage>();
    let actor_tx = tx.clone();
    thread::spawn(move || run_backend_actor(rx, actor_tx));
    BackendClient { tx }
}

async fn backend_request(
    client: BackendClient,
    method: String,
    payload: Value,
) -> Result<Value, String> {
    let started_at = Instant::now();
    let (response_tx, response_rx) = async_response_channel();
    client
        .tx
        .send(BackendActorMessage::Request(BackendCommand {
            method: method.clone(),
            payload,
            response: response_tx,
        }))
        .map_err(|err| format!("Backend request channel is closed: {err}"))?;

    let result = response_rx.await;
    let duration_ms = started_at.elapsed().as_millis();
    if duration_ms >= 50 {
        eprintln!("perf backend.request method={method} duration_ms={duration_ms}");
    }
    result
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
        return if status.success() {
            Ok(Value::Null)
        } else {
            Err(format!("pbcopy exited with {status}"))
        };
    }
    Err("Clipboard copy is not implemented for this platform yet.".to_string())
}

fn read_text() -> Result<Value, String> {
    if cfg!(target_os = "macos") {
        let output = Command::new("pbpaste")
            .output()
            .map_err(|err| err.to_string())?;
        if output.status.success() {
            return Ok(Value::String(
                String::from_utf8_lossy(&output.stdout).to_string(),
            ));
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
async fn tauri_backend_request(
    app: AppHandle,
    state: State<'_, BackendState>,
    request: BackendRequest,
) -> Result<Value, String> {
    if let Some(result) = handle_host_request(&app, &request) {
        return result;
    }
    let client = state.client.clone();
    backend_request(client, request.method, request.payload).await
}

fn main() {
    tauri::Builder::default()
        .manage(BackendState {
            client: create_backend_client(),
        })
        .invoke_handler(tauri::generate_handler![tauri_backend_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn routes_backend_responses_by_id_out_of_order() {
        let (first_tx, first_rx) = async_response_channel();
        let (second_tx, second_rx) = async_response_channel();
        let mut pending = HashMap::new();
        pending.insert(1, first_tx);
        pending.insert(2, second_tx);

        assert!(deliver_backend_response(
            &mut pending,
            BackendLineResponse {
                id: 2,
                ok: true,
                result: json!({ "value": "second" }),
                error: String::new(),
            },
        ));
        assert!(deliver_backend_response(
            &mut pending,
            BackendLineResponse {
                id: 1,
                ok: true,
                result: json!({ "value": "first" }),
                error: String::new(),
            },
        ));

        assert_eq!(
            tauri::async_runtime::block_on(second_rx).unwrap(),
            json!({ "value": "second" })
        );
        assert_eq!(
            tauri::async_runtime::block_on(first_rx).unwrap(),
            json!({ "value": "first" })
        );
        assert!(pending.is_empty());
    }

    #[test]
    fn routes_backend_errors_by_id() {
        let (response_tx, response_rx) = async_response_channel();
        let mut pending = HashMap::new();
        pending.insert(7, response_tx);

        assert!(deliver_backend_response(
            &mut pending,
            BackendLineResponse {
                id: 7,
                ok: false,
                result: Value::Null,
                error: "failed".to_string(),
            },
        ));

        assert_eq!(
            tauri::async_runtime::block_on(response_rx).unwrap_err(),
            "failed"
        );
    }
}
