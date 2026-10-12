// Viewport: transformação mundo ↔ tela. Y do mundo cresce para cima; Y da tela para baixo.

import { boxIsEmpty } from './geometry.js';

export class Viewport {
    constructor(width = 800, height = 600) {
        this.width = width;
        this.height = height;
        this.scale = 4; // pixels por unidade de desenho
        this.originX = width / 2; // posição em tela do (0,0) do mundo
        this.originY = height / 2;
        this.minScale = 1e-5;
        this.maxScale = 1e5;
    }

    resize(width, height) {
        // Mantém o centro do mundo fixo ao redimensionar.
        const center = this.screenToWorld({ x: this.width / 2, y: this.height / 2 });
        this.width = width;
        this.height = height;
        this.centerOn(center);
    }

    worldToScreen(p) {
        return { x: p.x * this.scale + this.originX, y: -p.y * this.scale + this.originY };
    }

    screenToWorld(s) {
        return { x: (s.x - this.originX) / this.scale, y: -(s.y - this.originY) / this.scale };
    }

    pixelsToWorld(px) {
        return px / this.scale;
    }

    pan(dxPixels, dyPixels) {
        this.originX += dxPixels;
        this.originY += dyPixels;
    }

    zoomAt(screenPoint, factor) {
        const next = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
        const real = next / this.scale;
        this.originX = screenPoint.x - (screenPoint.x - this.originX) * real;
        this.originY = screenPoint.y - (screenPoint.y - this.originY) * real;
        this.scale = next;
    }

    centerOn(worldPoint) {
        this.originX = this.width / 2 - worldPoint.x * this.scale;
        this.originY = this.height / 2 + worldPoint.y * this.scale;
    }

    zoomToBox(box, margin = 0.08) {
        if (!box || boxIsEmpty(box)) {
            this.scale = 4;
            this.centerOn({ x: 0, y: 0 });
            return;
        }
        const w = Math.max(box.maxX - box.minX, 1e-6);
        const h = Math.max(box.maxY - box.minY, 1e-6);
        const sx = (this.width * (1 - margin * 2)) / w;
        const sy = (this.height * (1 - margin * 2)) / h;
        this.scale = Math.min(this.maxScale, Math.max(this.minScale, Math.min(sx, sy)));
        this.centerOn({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 });
    }

    visibleBox() {
        const a = this.screenToWorld({ x: 0, y: this.height });
        const b = this.screenToWorld({ x: this.width, y: 0 });
        return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
    }

    getView() {
        const center = this.screenToWorld({ x: this.width / 2, y: this.height / 2 });
        const height = this.scale > 0 ? this.height / this.scale : 100;
        const aspectRatio = this.width > 0 && this.height > 0 ? this.width / this.height : 1;
        return {
            center: { x: center.x, y: center.y },
            height,
            aspectRatio,
        };
    }

    setView(params) {
        if (!params || typeof params !== 'object') return false;
        const { center, height } = params;
        if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(height) || height <= 0) {
            return false;
        }
        if (this.height <= 0) return false;
        const nextScale = this.height / height;
        this.scale = Math.min(this.maxScale, Math.max(this.minScale, nextScale));
        this.centerOn(center);
        return true;
    }

    // Espaçamento de grade "bonito" para o zoom atual (aprox. 60px entre linhas maiores).
    gridSpacing(targetPixels = 60) {
        const raw = targetPixels / this.scale;
        const power = 10 ** Math.floor(Math.log10(raw));
        const candidates = [1, 2, 5, 10].map((m) => m * power);
        return candidates.reduce((best, c) => (Math.abs(c - raw) < Math.abs(best - raw) ? c : best), candidates[0]);
    }
}

