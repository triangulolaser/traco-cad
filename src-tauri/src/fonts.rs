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

fn with_font<T>(family: &str, bold: bool, italic: bool, read: impl FnOnce(&[u8], u32) -> Result<T, String>) -> Result<T, String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let id = db.query(&fontdb::Query {
        families: &[fontdb::Family::Name(family)],
        weight: if bold { fontdb::Weight::BOLD } else { fontdb::Weight::NORMAL },
        style: if italic { fontdb::Style::Italic } else { fontdb::Style::Normal },
        ..Default::default()
    }).ok_or_else(|| format!("Fonte não encontrada: {family}"))?;
    let face = db.face(id).ok_or_else(|| "Fonte indisponível".to_string())?;
    if (face.weight.0 >= 600) != bold || (face.style != fontdb::Style::Normal) != italic {
        return Err(format!("A variante solicitada de {family} não está instalada"));
    }
    db.with_face_data(id, read).ok_or_else(|| "Não foi possível ler a fonte instalada".to_string())?
}

/// Font bytes stay within the local application, never uploaded or bundled.
#[tauri::command]
pub async fn read_system_font(family: String, bold: bool, italic: bool) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || with_font(&family, bold, italic, |data, index| {
        if index != 0 { return Err("Esta face pertence a uma coleção. Instale a versão TTF/OTF individual para usá-la no desenho".to_string()); }
        Ok(data.to_vec())
    }))
        .await.map_err(|error| error.to_string())?
}

#[derive(serde::Serialize)]
pub struct GlyphOutline { advance: i32, offset_x: i32, offset_y: i32, commands: Vec<Vec<f32>> }
#[derive(serde::Serialize)]
pub struct TextOutlines { units_per_em: u16, glyphs: Vec<GlyphOutline> }
#[derive(Default)]
struct Outline(Vec<Vec<f32>>);
impl ttf_parser::OutlineBuilder for Outline {
    fn move_to(&mut self, x: f32, y: f32) { self.0.push(vec![0., x, y]); }
    fn line_to(&mut self, x: f32, y: f32) { self.0.push(vec![1., x, y]); }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) { self.0.push(vec![2., x1, y1, x, y]); }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) { self.0.push(vec![3., x1, y1, x2, y2, x, y]); }
    fn close(&mut self) { self.0.push(vec![4.]); }
}
fn parse_outlines(data: &[u8], index: u32, text: &str) -> Result<TextOutlines, String> {
        let face = ttf_parser::Face::parse(data, index).map_err(|e| e.to_string())?;
        let shaping_face = rustybuzz::Face::from_slice(data, index).ok_or_else(|| "Fonte sem dados de composição".to_string())?;
        let mut buffer = rustybuzz::UnicodeBuffer::new();
        buffer.push_str(text);
        buffer.guess_segment_properties();
        let shaped = rustybuzz::shape(&shaping_face, &[], buffer);
        let mut glyphs = Vec::new();
        for (info, pos) in shaped.glyph_infos().iter().zip(shaped.glyph_positions()) {
            let ch = text.get(info.cluster as usize..).and_then(|s| s.chars().next()).unwrap_or(' ');
            if info.glyph_id == 0 { return Err(format!("A fonte não contém o caractere {ch}")); }
            let id = ttf_parser::GlyphId(info.glyph_id as u16);
            let mut path = Outline::default();
            face.outline_glyph(id, &mut path);
            if !ch.is_whitespace() && path.0.is_empty() { return Err(format!("Sem contorno vetorial para {ch}")); }
            glyphs.push(GlyphOutline { advance: pos.x_advance, offset_x: pos.x_offset, offset_y: pos.y_offset, commands: path.0 });
        }
        Ok(TextOutlines { units_per_em: face.units_per_em(), glyphs })
}
#[tauri::command]
pub async fn system_text_outlines(family: String, bold: bool, italic: bool, text: String, bytes: Option<Vec<u8>>) -> Result<TextOutlines, String> {
    if text.chars().count() > 10000 { return Err("Selecione textos de até 10000 caracteres".to_string()); }
    tauri::async_runtime::spawn_blocking(move || match bytes {
        Some(data) => parse_outlines(&data, 0, &text),
        None => with_font(&family, bold, italic, |data, index| parse_outlines(data, index, &text)),
    })
        .await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod outline_tests {
    #[test]
    fn installed_font_outlines_preserve_holes_and_reject_missing_family() {
        let family = super::system_font_families().into_iter().find(|s| s.contains("Sans")).expect("test host font");
        let result = super::with_font(&family, false, false, |data, index| super::parse_outlines(data, index, "O A36 | 1,20 mm | peça(s)")).unwrap();
        assert!(result.units_per_em > 0);
        assert!(result.glyphs[0].commands.iter().filter(|c| c[0] == 4.).count() >= 2, "O must preserve the inner and outer loops");
        assert!(result.glyphs.iter().all(|g| g.advance > 0));
        assert!(super::with_font("TracoDefinitelyMissingFont592517", false, false, |data, index| super::parse_outlines(data, index, "A")).is_err());
        if family == "DejaVu Sans" {
            let shape = |text| super::with_font(&family, false, false, |data, index| super::parse_outlines(data, index, text)).unwrap();
            let pair = shape("AV").glyphs.iter().map(|g| g.advance).sum::<i32>();
            let separate = shape("A").glyphs[0].advance + shape("V").glyphs[0].advance;
            assert!(pair < separate, "kerning must match shaped text, not raw character advances");
            assert!(shape("ffi").glyphs.len() < 3, "ligature contours must follow shaping");
        }
        println!("Real installed font outlines and shaping validated: {family}");
    }
}
