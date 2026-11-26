// Novidades exibidas no aviso de atualização. O título já diz o nome e a
// versão ("Traço 0.3.89 disponível"), então um prefixo repetido no texto
// ("Traço 0.3.89: ...", "0.3.89 - ...") é removido para não dizer duas vezes.
function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function updateNotesText(body, { appName = 'Traço', version = '' } = {}) {
    let text = String(body ?? '').trim();
    if (!text || !version) return text;
    const app = escapeRegExp(appName);
    const ver = escapeRegExp(String(version).replace(/^v/i, ''));
    const prefix = new RegExp(`^(?:${app}(?:\\s+CAD)?\\s+)?v?${ver}\\s*(?:[:–—-]\\s*|$)`, 'iu');
    text = text.replace(prefix, '').trim();
    return text;
}
