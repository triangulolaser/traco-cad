// Terminal de comandos (linha de comando estilo BricsCAD).

export class Terminal {
    constructor(root) {
        this.root = root;
        this.history = root.querySelector('[data-cad-terminal-history]');
        this.prompt = root.querySelector('[data-cad-terminal-prompt]');
        this.input = root.querySelector('[data-cad-terminal-input]');
        this.entries = [];
        this.cursor = -1;
        this.onSubmit = () => {};
        this.acceptsSpaces = () => false;
        this.onCancel = () => {};
        this.onTab = () => {};
        this.getSuggestions = () => [];
        this.suggestions = [];
        this.suggestIndex = -1;
        this.suggestBox = null;
        this.maxLines = 400;
        this.bind();
    }

    bind() {
        this.input.addEventListener('input', () => this.refreshSuggestions());
        this.input.addEventListener('blur', () => setTimeout(() => this.hideSuggestions(), 120));
        this.input.addEventListener('keydown', (event) => {
            if (event.isComposing || event.keyCode === 229) return;
            if (this.suggestions.length && this.handleSuggestionKey(event)) return;
            if (event.key === 'Enter' || (event.key === ' ' && !this.acceptsSpaces() && !event.ctrlKey && !event.metaKey && !event.altKey)) {
                event.preventDefault();
                const value = this.input.value;
                this.input.value = '';
                this.hideSuggestions();
                if (value.trim()) {
                    this.entries.push(value);
                    if (this.entries.length > 100) this.entries.shift();
                }
                this.cursor = this.entries.length;
                this.onSubmit(value);
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                this.input.value = '';
                this.hideSuggestions();
                this.onCancel();
                return;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (this.entries.length === 0) return;
                this.cursor = Math.max(0, this.cursor - 1);
                this.input.value = this.entries[this.cursor] ?? '';
                return;
            }
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                this.cursor = Math.min(this.entries.length, this.cursor + 1);
                this.input.value = this.entries[this.cursor] ?? '';
                return;
            }
            if (event.key === 'Tab' && !event.ctrlKey) {
                event.preventDefault();
                this.onTab();
            }
        });
        this.root.addEventListener('click', () => this.input.focus());
    }

    // Lista de comandos que começam com o texto digitado (estilo BricsCAD/AutoCAD).
    // Enter/Espaço usam a sugestão destacada (a primeira, ou a escolhida com Tab/setas).
    // Esc apaga o texto digitado e fecha a lista, como em qualquer prompt.
    refreshSuggestions() {
        const value = this.input.value;
        const list = /\s/.test(value) ? [] : (this.getSuggestions(value) ?? []);
        this.suggestions = list;
        // A mais próxima já vem destacada: Espaço/Enter executa "conc" como CONCORDAR (FILLET).
        this.suggestIndex = list.length ? 0 : -1;
        this.renderSuggestions();
    }

    handleSuggestionKey(event) {
        const n = this.suggestions.length;
        // Tab/Shift+Tab alternam entre as sugestões como as setas; Espaço ou Enter confirma a destacada.
        const tab = event.key === 'Tab' && !event.ctrlKey;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || tab) {
            event.preventDefault();
            const step = event.key === 'ArrowUp' || (tab && event.shiftKey) ? -1 : 1;
            this.suggestIndex = this.suggestIndex < 0 ? (step > 0 ? 0 : n - 1) : (this.suggestIndex + step + n) % n;
            this.renderSuggestions();
            return true;
        }
        if ((event.key === 'Enter' || (event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey)) && this.suggestIndex >= 0) {
            this.input.value = this.suggestions[this.suggestIndex].name;
        }
        return false;
    }

    pickSuggestion(index) {
        const item = this.suggestions[index];
        if (!item) return;
        this.hideSuggestions();
        this.input.value = '';
        this.entries.push(item.name);
        if (this.entries.length > 100) this.entries.shift();
        this.cursor = this.entries.length;
        this.onSubmit(item.name);
        this.input.focus?.();
    }

    hideSuggestions() {
        this.suggestions = [];
        this.suggestIndex = -1;
        this.renderSuggestions();
    }

    renderSuggestions() {
        if (typeof document === 'undefined' || !this.input.parentElement) return;
        if (!this.suggestBox) {
            this.suggestBox = document.createElement('ul');
            this.suggestBox.className = 'cad-terminal-suggest';
            this.suggestBox.setAttribute('role', 'listbox');
            this.suggestBox.addEventListener('mousedown', (event) => {
                const li = event.target.closest('li[data-index]');
                if (!li) return;
                event.preventDefault();
                this.pickSuggestion(Number(li.dataset.index));
            });
            this.input.parentElement.appendChild(this.suggestBox);
        }
        const box = this.suggestBox;
        box.replaceChildren();
        box.hidden = this.suggestions.length === 0;
        this.suggestions.forEach((item, i) => {
            const li = document.createElement('li');
            li.dataset.index = String(i);
            li.textContent = item.label;
            li.title = item.description;
            li.setAttribute('role', 'option');
            if (i === this.suggestIndex) {
                li.className = 'is-active';
                li.setAttribute('aria-selected', 'true');
            }
            box.appendChild(li);
        });
        box.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' });
    }

    setPrompt(text) {
        this.prompt.textContent = text;
        this.input.setAttribute('aria-label', text);
    }

    log(text, kind = 'info') {
        const line = document.createElement('div');
        line.className = `cad-terminal-line is-${kind}`;
        line.textContent = text;
        this.history.appendChild(line);
        while (this.history.children.length > this.maxLines) this.history.removeChild(this.history.firstChild);
        this.history.scrollTop = this.history.scrollHeight;
    }

    echo(prompt, value) {
        this.log(`${prompt} ${value}`, 'echo');
    }

    focus() {
        this.input.focus();
    }

    value() {
        return this.input.value;
    }

    setValue(value) {
        this.input.value = value;
        this.hideSuggestions();
    }

    isFocused() {
        return document.activeElement === this.input;
    }

    clear() {
        if (this.history) this.history.innerHTML = '';
        if (this.input) this.input.value = '';
        this.hideSuggestions();
        this.entries = [];
        this.cursor = -1;
    }
}
