// Desktop PDFs must use the same native binary read as Finder/Explorer drops.
// Keep browser File input for the web app, and consume an existing drop first.
export async function pickPdfFile(editor, bridge = globalThis.window?.desktopBridge) {
    if (editor.pendingDropFile) return editor.pickFile('.pdf,application/pdf');
    if (!bridge?.showOpenDialog || !bridge?.readFileBinary) {
        return editor.pickFile('.pdf,application/pdf');
    }
    const selected = await bridge.showOpenDialog({
        multiple: false,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return null;
    const bytes = await bridge.readFileBinary(path);
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const name = path.split(/[\\/]/).pop();
    const file = new File([data], name, { type: 'application/pdf' });
    file.filePath = path;
    return file;
}
