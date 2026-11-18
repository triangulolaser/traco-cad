import { normalizeFontFamily, rememberFontFamily } from './fonts.js';

// One list for bundled and installed families; never a second name input.
export function mergeFontOptions(select, families) {
    const current = select.value;
    const names = [...new Set([...Array.from(select.options, option => option.value), ...families]
        .map(normalizeFontFamily).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    select.replaceChildren(...names.map(name => {
        const option = document.createElement('option');
        option.value = name; option.textContent = name;
        return option;
    }));
    select.value = current;
}

export function attachLocalFontPicker(select) {
    const panel = document.createElement('span');
    panel.className = 'cad-local-font-picker';
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    panel.append(status); select.after(panel);
    const bridge = globalThis.window?.desktopBridge;
    const query = globalThis.window?.queryLocalFonts;
    const load = async () => {
        status.textContent = 'Carregando fontes do sistema…';
        try {
            const names = bridge?.listSystemFonts
                ? await bridge.listSystemFonts()
                : (await query.call(window)).map(font => font.family);
            if (!select.isConnected) return;
            mergeFontOptions(select, names);
            status.textContent = 'Fontes do sistema incluídas na lista.';
        } catch {
            status.textContent = 'Não foi possível listar fontes do sistema. As fontes disponíveis continuam na lista.';
        }
    };
    if (bridge?.listSystemFonts) load();
    else if (query) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = 'Incluir fontes do sistema';
        button.addEventListener('click', async event => {
            event.stopPropagation(); button.disabled = true;
            await load(); button.disabled = false;
        });
        panel.prepend(button);
    } else status.textContent = 'A lista completa de fontes do sistema está disponível no Traço desktop.';
    select.addEventListener('change', () => { if (select.value) rememberFontFamily(select.value); });
    return panel;
}
