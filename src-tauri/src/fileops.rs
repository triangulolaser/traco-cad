//! Gravação em disco do desktop. Roda fora da thread principal (ver `lib.rs`), então pode
//! demorar em pasta de rede sem parar a tela.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

// Com a tela livre o usuário pode salvar de novo antes de a gravação anterior terminar.
static SAVE_LOCK: Mutex<()> = Mutex::new(());

fn save_guard() -> MutexGuard<'static, ()> {
    SAVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Espera a gravação em andamento antes de o app fechar, para não deixar arquivo pela metade.
pub fn wait_for_pending_save() {
    drop(save_guard());
}

/// Grava `contents` em `path`, guardando antes a versão anterior em `.bak`.
/// Falha na cópia não impede a gravação: volta como aviso para o usuário saber que está sem ela.
pub fn save(path: &Path, contents: &[u8]) -> Result<Option<String>, String> {
    let _guard = save_guard();
    let warning = backup_previous(path).err().map(|e| e.to_string());
    fs::write(path, contents).map_err(|e| e.to_string())?;
    Ok(warning)
}

pub fn file_exists(path: &Path) -> Result<bool, String> {
    match fs::metadata(path) {
        Ok(meta) => Ok(meta.is_file()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

fn backup_previous(path: &Path) -> io::Result<()> {
    let meta = match fs::metadata(path) {
        Ok(meta) if meta.is_file() => meta,
        Ok(_) => return Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    // Arquivo vazio não tem o que recuperar e não pode apagar uma cópia boa.
    if meta.len() == 0 {
        return Ok(());
    }
    // Passa por um temporário: cópia interrompida não destrói o .bak anterior.
    let backup = path.with_extension("bak");
    let tmp = path.with_extension("bak.tmp");
    let result = copy_verified(path, &tmp, meta.len())
        .and_then(|_| {
            let _ = fs::set_permissions(&tmp, meta.permissions());
            fs::rename(&tmp, &backup)
        });
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

// Copia só os dados, sem `fs::copy`: no macOS ele usa copyfile, que também leva os metadados e,
// em compartilhamento SMB sem streams, abre o `._arquivo` ao lado.
fn copy_verified(from: &Path, to: &Path, expected: u64) -> io::Result<()> {
    let mut reader = File::open(from)?;
    let mut writer = File::create(to)?;
    let copied = io::copy(&mut reader, &mut writer)?;
    writer.flush()?;
    // Nem todo sistema de arquivos aceita sync; o tamanho conferido abaixo é a verificação.
    let _ = writer.sync_all();
    drop(writer);
    let written = fs::metadata(to)?.len();
    if copied != expected || written != expected {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            format!("cópia incompleta ({written} de {expected} bytes)"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("traco-fileops-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn arquivo_novo_nao_gera_bak() {
        let dir = temp_dir("novo");
        let path = dir.join("new block.dxf");
        assert_eq!(save(&path, b"um").unwrap(), None);
        assert_eq!(fs::read(&path).unwrap(), b"um");
        assert!(!dir.join("new block.bak").exists());
    }

    #[test]
    fn bak_recebe_a_versao_anterior_inteira() {
        let dir = temp_dir("bak");
        let path = dir.join("new block.dxf");
        let previous = vec![7u8; 300_000];
        fs::write(&path, &previous).unwrap();
        assert_eq!(save(&path, b"novo").unwrap(), None);
        assert_eq!(fs::read(&path).unwrap(), b"novo");
        assert_eq!(fs::read(dir.join("new block.bak")).unwrap(), previous);
        assert!(!dir.join("new block.bak.tmp").exists());
    }

    #[test]
    fn bak_vazio_e_substituido_na_gravacao_seguinte() {
        let dir = temp_dir("bak-vazio");
        let path = dir.join("a.dxf");
        fs::write(dir.join("a.bak"), b"").unwrap();
        fs::write(&path, b"anterior").unwrap();
        save(&path, b"novo").unwrap();
        assert_eq!(fs::read(dir.join("a.bak")).unwrap(), b"anterior");
    }

    #[test]
    fn arquivo_vazio_nao_apaga_bak_bom() {
        let dir = temp_dir("origem-vazia");
        let path = dir.join("a.dxf");
        fs::write(dir.join("a.bak"), b"bom").unwrap();
        fs::write(&path, b"").unwrap();
        assert_eq!(save(&path, b"novo").unwrap(), None);
        assert_eq!(fs::read(dir.join("a.bak")).unwrap(), b"bom");
    }

    #[test]
    fn falha_na_copia_vira_aviso_e_mantem_a_gravacao() {
        let dir = temp_dir("falha");
        let path = dir.join("a.dxf");
        fs::write(&path, b"anterior").unwrap();
        // Diretório no lugar do temporário: a cópia falha em qualquer sistema.
        fs::create_dir(dir.join("a.bak.tmp")).unwrap();
        fs::write(dir.join("a.bak"), b"bom").unwrap();
        let warning = save(&path, b"novo").unwrap();
        assert!(warning.is_some());
        assert_eq!(fs::read(&path).unwrap(), b"novo");
        assert_eq!(fs::read(dir.join("a.bak")).unwrap(), b"bom");
    }

    #[test]
    fn gravacao_falha_devolve_erro() {
        let dir = temp_dir("sem-pasta");
        assert!(save(&dir.join("nao-existe/a.dxf"), b"x").is_err());
    }

    #[test]
    fn existencia_sem_ler_o_arquivo() {
        let dir = temp_dir("existe");
        let path = dir.join("a.dxf");
        assert_eq!(file_exists(&path), Ok(false));
        fs::write(&path, b"x").unwrap();
        assert_eq!(file_exists(&path), Ok(true));
        assert_eq!(file_exists(&dir), Ok(false));
    }
}
