/**
 * Modal de feedback e diagnóstico de erro para o Traço CAD.
 * Garante que falhas de importação (DWG, DXF, rede, conversor) sejam visíveis
 * e compreensíveis para o operador, mesmo quando o workspace estiver vazio (.is-empty).
 */

export function showCadErrorModal(root, {
    title = 'Falha ao abrir arquivo',
    fileName = '',
    message = 'Não foi possível carregar o desenho solicitado.',
    details = '',
    onRetry = null,
} = {}) {
    if (!root) return null;

    hideCadErrorModal(root);

    const overlay = document.createElement('div');
    overlay.className = 'cad-error-overlay';
    overlay.setAttribute('data-cad-error-modal', '');
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cadErrorModalTitle');

    const cleanTitle = escapeHtml(title);
    const cleanFileName = fileName ? escapeHtml(fileName) : '';
    const cleanMessage = escapeHtml(message);
    const cleanDetails = details ? escapeHtml(details) : '';

    overlay.innerHTML = `
        <div class="cad-error-modal" role="document">
            <div class="cad-error-header">
                <div class="cad-error-badge">
                    <i class="bi bi-exclamation-triangle-fill"></i>
                    <span>Atenção</span>
                </div>
                <h2 id="cadErrorModalTitle" class="cad-error-title">${cleanTitle}</h2>
                ${cleanFileName ? `<div class="cad-error-filename" title="${cleanFileName}"><i class="bi bi-file-earmark-code"></i> ${cleanFileName}</div>` : ''}
            </div>
            <div class="cad-error-body">
                <p class="cad-error-message">${cleanMessage}</p>
                ${cleanDetails ? `<div class="cad-error-details"><strong>Detalhes:</strong> ${cleanDetails}</div>` : ''}
            </div>
            <div class="cad-error-footer">
                ${typeof onRetry === 'function' ? `
                    <button type="button" class="cad-btn cad-btn-primary" data-cad-error-action="retry">
                        <i class="bi bi-arrow-clockwise"></i> Tentar novamente
                    </button>
                ` : ''}
                <button type="button" class="cad-btn cad-btn-secondary" data-cad-error-action="close">
                    Fechar
                </button>
            </div>
        </div>
    `;

    const closeBtn = overlay.querySelector('[data-cad-error-action="close"]');
    const retryBtn = overlay.querySelector('[data-cad-error-action="retry"]');

    const dismiss = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKeyDown);
    };

    const onKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            dismiss();
        }
    };

    closeBtn?.addEventListener('click', dismiss);

    retryBtn?.addEventListener('click', () => {
        dismiss();
        try {
            onRetry();
        } catch (err) {
            console.error('Falha ao tentar novamente importação:', err);
        }
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) dismiss();
    });

    document.addEventListener('keydown', onKeyDown);

    root.appendChild(overlay);

    // Auto-focus no botão de fechar ou tentar novamente
    const focusTarget = retryBtn || closeBtn;
    if (focusTarget && typeof focusTarget.focus === 'function') {
        setTimeout(() => focusTarget.focus(), 50);
    }

    return overlay;
}

export function hideCadErrorModal(root) {
    if (!root) return;
    const existing = root.querySelectorAll('[data-cad-error-modal]');
    existing.forEach((el) => el.remove());
}

function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c]));
}
