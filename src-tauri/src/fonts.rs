fn system_font_families() -> Vec<String> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();
    let families: std::collections::BTreeSet<String> = database.faces()
        .flat_map(|face| face.families.iter().map(|(family, _)| family.trim().to_owned()))
        .filter(|family| !family.is_empty() && family.len() <= 640 && !family.chars().any(char::is_control))
        .collect();
    families.into_iter().collect()
}

/// Enumerates family metadata locally. Font files never cross the IPC bridge.
#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(system_font_families)
        .await.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn native_font_enumeration_is_sorted_and_unique() {
        let families = super::system_font_families();
        assert!(!families.is_empty(), "desktop test host must have installed fonts");
        assert!(families.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(families.iter().all(|family| !family.chars().any(char::is_control)));
        println!("Enumerated {} system font families", families.len());
    }
}
