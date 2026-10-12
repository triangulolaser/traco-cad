use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::RunEvent;

#[derive(Clone, Serialize)]
pub struct OpenedFile {
    pub path: String,
    pub name: String,
    pub bytes: Vec<u8>,
}

#[derive(Default)]
pub struct PendingFilesState(pub Mutex<Vec<OpenedFile>>);

#[tauri::command]
fn get_pending_open_files(state: tauri::State<'_, PendingFilesState>) -> Vec<OpenedFile> {
    let mut lock = state.0.lock().unwrap();
    let files = lock.clone();
    lock.clear();
    files
}

#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_file() {
        let bak = p.with_extension("bak");
        let _ = std::fs::copy(p, bak);
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file_binary(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_file() {
        let bak = p.with_extension("bak");
        let _ = std::fs::copy(p, bak);
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file_binary(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn convert_dwg_to_dxf(path: Option<String>, bytes: Option<Vec<u8>>) -> Result<String, String> {
    let candidates = [
        "/opt/homebrew/bin/dwg2dxf",
        "/usr/local/bin/dwg2dxf",
        "dwg2dxf",
    ];
    let mut binary_path = None;
    for cand in candidates {
        if cand.starts_with('/') {
            if std::path::Path::new(cand).is_file() {
                binary_path = Some(cand.to_string());
                break;
            }
        } else if let Ok(output) = std::process::Command::new("which").arg(cand).output() {
            if output.status.success() {
                let found = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !found.is_empty() {
                    binary_path = Some(found);
                    break;
                }
            }
        }
    }

    let bin = binary_path.ok_or_else(|| {
        "Utilitário de conversão DWG (dwg2dxf / LibreDWG) não encontrado no sistema. Instale via 'brew install libredwg'.".to_string()
    })?;

    let temp_dir = std::env::temp_dir().join(format!("traco_dwg_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let input_path = if let Some(p) = path {
        if std::path::Path::new(&p).is_file() {
            PathBuf::from(p)
        } else if let Some(b) = bytes {
            let tmp_in = temp_dir.join("input.dwg");
            std::fs::write(&tmp_in, b).map_err(|e| e.to_string())?;
            tmp_in
        } else {
            return Err("Arquivo DWG não encontrado no caminho especificado.".to_string());
        }
    } else if let Some(b) = bytes {
        let tmp_in = temp_dir.join("input.dwg");
        std::fs::write(&tmp_in, b).map_err(|e| e.to_string())?;
        tmp_in
    } else {
        return Err("Nenhum dado ou caminho de arquivo DWG fornecido.".to_string());
    };

    let output_path = temp_dir.join("output.dxf");

    let output = std::process::Command::new(&bin)
        .arg("-y")
        .arg("-o")
        .arg(&output_path)
        .arg(&input_path)
        .output()
        .map_err(|e| format!("Falha ao executar dwg2dxf: {}", e))?;

    if !output_path.is_file() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(format!("dwg2dxf não gerou o DXF de saída. Erro: {} {}", stderr, stdout));
    }

    let dxf_content = std::fs::read_to_string(&output_path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&temp_dir);

    if !dxf_content.contains("SECTION") || !dxf_content.contains("EOF") {
        return Err("O arquivo DXF gerado a partir do DWG é inválido ou incompleto.".to_string());
    }

    Ok(dxf_content)
}

fn read_and_dispatch_file(app_handle: &tauri::AppHandle, path: PathBuf) {
    if !path.is_file() {
        return;
    }
    if let Ok(bytes) = std::fs::read(&path) {
        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "desenho.dxf".to_string());
        let file = OpenedFile {
            path: path.to_string_lossy().to_string(),
            name,
            bytes,
        };

        // Envia para o frontend se ele já estiver ativo e ouvindo o evento:
        let _ = app_handle.emit("file-opened", &file);

        // Armazena no estado pendente para o carregamento a frio (cold boot):
        if let Some(state) = app_handle.try_state::<PendingFilesState>() {
            let mut lock = state.0.lock().unwrap();
            lock.push(file);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(PendingFilesState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_pending_open_files, write_file, write_file_binary, read_file_text, read_file_binary, convert_dwg_to_dxf])
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Captura arquivos passados como argumentos CLI na inicialização:
            for arg in std::env::args().skip(1) {
                let p = PathBuf::from(&arg);
                if p.is_file() {
                    read_and_dispatch_file(&app.handle(), p);
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    // RunEvent::Opened só existe no macOS/iOS; no Windows e no Linux o arquivo
    // chega como argumento de linha de comando (tratado no setup acima).
    app.run(|_app_handle, _event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let RunEvent::Opened { urls } = _event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    read_and_dispatch_file(_app_handle, path);
                }
            }
        }
    });
}
