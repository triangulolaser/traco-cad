/** Secondary desktop toolbar controls retain their existing CAD event handlers. */
export function initToolbarMenu(root = document) {
    const toggle = root.querySelector('[data-desktop-more]');
    const menu = root.querySelector('#desktop-more-menu');
    if (!toggle || !menu || toggle.dataset.menuReady) return;
    toggle.dataset.menuReady = '1';
    const doc = toggle.ownerDocument;
    const close = (restoreFocus = false) => {
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        if (restoreFocus) toggle.focus();
    };
    const controls = () => [...menu.querySelectorAll('button:not(:disabled), select:not(:disabled)')];
    toggle.addEventListener('click', () => {
        if (!menu.hidden) return close();
        menu.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        controls()[0]?.focus();
    });
    menu.addEventListener('click', (event) => {
        if (event.target.closest('button')) close();
    });
    menu.addEventListener('change', () => close(true));
    doc.addEventListener('pointerdown', (event) => {
        if (!menu.contains(event.target) && !toggle.contains(event.target)) close();
    });
    doc.addEventListener('focusin', (event) => {
        if (!menu.contains(event.target) && !toggle.contains(event.target)) close();
    });
    doc.addEventListener('keydown', (event) => {
        if (menu.hidden) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            close(true);
        } else if (menu.contains(event.target) && event.target.tagName !== 'SELECT' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const items = controls();
            const index = items.indexOf(doc.activeElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
        }
    });
}
