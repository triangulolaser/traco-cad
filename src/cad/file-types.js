// Fonte única dos formatos que o Traço abre.
//
// O portão do clique na árvore do laser, o `accept` do seletor de arquivos, o ícone da lista
// e o roteamento da importação saíam de três listas separadas. O suporte a .lxds entrou no
// importador e no `accept`, mas não no portão da árvore, e clicar no arquivo respondia
// "Tipo .lxds não abre no CAD" com o importador pronto do outro lado. Tudo deriva daqui.

export const FILE_TYPES = {
    dwg: { kind: 'dwg', icon: 'vector-pen' },
    dxf: { kind: 'dxf', icon: 'vector-pen' },
    lxds: { kind: 'lxds', icon: 'file-earmark-binary' },
    cdr: { kind: 'cdr', icon: 'palette' },
    svg: { kind: 'svg', icon: 'vector-pen' },
    eps: { kind: 'eps', icon: 'palette' },
    elmt: { kind: 'elmt', icon: 'diagram-3' },
    qet: { kind: 'qet', icon: 'diagram-2' },
    pdf: { kind: 'pdf', icon: 'file-earmark-pdf' },
    bmp: { kind: 'image', icon: 'image' },
    png: { kind: 'image', icon: 'image' },
    jpg: { kind: 'image', icon: 'image' },
    jpeg: { kind: 'image', icon: 'image' },
};

// Formatos que viram desenho direto; imagem e PDF passam por comando próprio.
export const DRAWING_KINDS = ['dwg', 'dxf', 'lxds', 'cdr', 'svg', 'eps', 'elmt', 'qet'];

export const OPENABLE_EXTENSIONS = new Set(Object.keys(FILE_TYPES));

export const FILE_ICONS = Object.fromEntries(Object.entries(FILE_TYPES).map(([ext, t]) => [ext, t.icon]));

export function extensionOf(name) {
    const m = /\.([A-Za-z0-9]+)$/.exec(String(name ?? ''));
    return m ? m[1].toLowerCase() : '';
}

// 'dwg' | 'dxf' | 'lxds' | 'cdr' | 'svg' | 'eps' | 'pdf' | 'image' | null
export function kindOf(nameOrExtension) {
    const raw = String(nameOrExtension ?? '').toLowerCase();
    const ext = raw.includes('.') ? extensionOf(raw) : raw;
    return FILE_TYPES[ext]?.kind ?? null;
}

export function iconOf(extension) {
    return FILE_ICONS[String(extension ?? '').toLowerCase()] ?? 'file-earmark';
}

// Lista para o atributo `accept` do seletor de arquivos de desenho.
export const DRAWING_ACCEPT = Object.entries(FILE_TYPES)
    .filter(([, t]) => DRAWING_KINDS.includes(t.kind))
    .map(([ext]) => `.${ext}`)
    .join(',');

// Imagens raster que o Abrir aceita; entram no desenho atual como referência (IMAGEATTACH).
export const IMAGE_ACCEPT = Object.entries(FILE_TYPES)
    .filter(([, t]) => t.kind === 'image')
    .map(([ext]) => `.${ext}`)
    .join(',');
