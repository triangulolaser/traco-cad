import {canvasFont} from './fonts.js';
import {expandInsert} from './blocks.js';
import { tr } from './i18n.js';
// Renderer Canvas 2D do CAD.

import { entityColor, visibleEntities, LINETYPES, layerOf, getDocumentSpatialIndex } from './document.js';
import { dimensionGeometry } from './dimensions.js';
import { ellipseSamples, ellipseIsFull, imageCorners, imageVisibleCorners } from './extra-entities.js';
import { sampleSpline } from './splines.js';
import { hatchPath, HATCH_PATTERNS, hatchBox, hatchLineRange } from './hatch.js';
import { ensureSplineGeometry } from './extra-entities.js';

const imageCache = new Map();
function loadImage(src, onReady) {
    if (imageCache.has(src)) return imageCache.get(src);
    const img = new Image();
    img.onload = () => onReady?.();
    img.src = src;
    imageCache.set(src, img);
    return img;
}
import { entityCurves, entityBox, boxesIntersect, polar, curveEndpoints, curveMidpoint, curveQuadrants, pointInBox } from './geometry.js';
import { getEntityGrips } from './grips.js';

export const THEMES = {
    dark: {
        name: 'dark',
        background: '#1c1c1e',
        grid: 'rgba(255,255,255,0.05)',
        gridMajor: 'rgba(255,255,255,0.10)',
        axisX: 'rgba(220,80,80,0.55)',
        axisY: 'rgba(90,200,110,0.55)',
        crosshair: 'rgba(255,255,255,0.55)',
        crosshairX: '#ff3b3b',
        crosshairY: '#2fe05a',
        originX: '#e2564f',
        originY: '#4fc46b',
        selection: '#4da3ff',
        preview: 'rgba(255,255,255,0.75)',
        rubber: 'rgba(255,255,255,0.6)',
        snap: '#ffd24d',
        tracking: '#7fd6a8',
        trackingLine: 'rgba(127,214,168,0.7)',
        windowFill: 'rgba(77,163,255,0.12)',
        windowStroke: '#4da3ff',
        crossingFill: 'rgba(90,200,110,0.12)',
        crossingStroke: '#5ac86e',
        grip: '#4da3ff',
        gripFill: '#1c1c1e',
        text: '#ffffff',
        // Cores de entidade que precisam trocar com o fundo (branco ACI 7 vira preto no claro).
        swap: { '#ffffff': '#ffffff' },
    },
    light: {
        name: 'light',
        background: '#fafafa',
        grid: 'rgba(0,0,0,0.05)',
        gridMajor: 'rgba(0,0,0,0.10)',
        axisX: 'rgba(200,60,60,0.55)',
        axisY: 'rgba(40,150,70,0.55)',
        crosshair: 'rgba(0,0,0,0.6)',
        crosshairX: '#d01010',
        crosshairY: '#079a2c',
        originX: '#c8342c',
        originY: '#1f8f5a',
        selection: '#0a84ff',
        preview: 'rgba(0,0,0,0.7)',
        rubber: 'rgba(0,0,0,0.55)',
        snap: '#d99a00',
        tracking: '#1f8f5a',
        trackingLine: 'rgba(31,143,90,0.7)',
        windowFill: 'rgba(10,132,255,0.10)',
        windowStroke: '#0a84ff',
        crossingFill: 'rgba(40,150,70,0.10)',
        crossingStroke: '#28a05a',
        grip: '#0a84ff',
        gripFill: '#fafafa',
        text: '#111111',
        swap: { '#ffffff': '#1a1a1a', '#ffff00': '#b58a00', '#00ffff': '#0088a8', '#00ff00': '#0f8a3c', '#c0c0c0': '#5a5a5a' },
    },
};

export const THEME = THEMES.dark;

export class Renderer {
    constructor(canvas, viewport) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.viewport = viewport;
        this.dpr = 1;
        this.theme = THEMES.dark;
    }

    setTheme(name) {
        this.theme = THEMES[name] ?? THEMES.dark;
    }

    // Ajusta cores de entidade ao fundo (ACI 7 é "cor do primeiro plano" nos CADs).
    entityDisplayColor(hex) {
        const key = String(hex).toLowerCase();
        return this.theme.swap[key] ?? hex;
    }

    resize(width, height, dpr = window.devicePixelRatio || 1) {
        this.dpr = dpr;
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        this.viewport.resize(width, height);
    }

    // state: { doc, selection:Set, preview:[], rubber:{from,to}, snap:{mode,point}, cursor, window:{a,b,crossing}, showGrid, showCrosshair, hover }
    draw(state) {
        const { ctx, viewport } = this;
        this.currentDimStyle = state.dimStyle;
        this.currentDoc=state.doc;
        ctx.save();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = this.theme.background;
        ctx.fillRect(0, 0, viewport.width, viewport.height);

        const isExperimentalLxds = Boolean(
            state.doc?.sourceFormat === 'lxds' ||
            state.doc?.layers?.some((l) => l.name === 'LXDS') ||
            /\.lxds/i.test(state.doc?.name ?? '')
        );
        if (isExperimentalLxds) this.drawLxdsBackgroundWatermark();

        if (state.showGrid) this.drawGrid();
        this.drawAxes();

        const visible = viewport.visibleBox();
        const spatial = state.doc ? getDocumentSpatialIndex(state.doc) : null;
        const entities = spatial ? spatial.search(visible) : visibleEntities(state.doc);
        const hidden = state.hiddenIds ?? new Set();
        const batches = new Map();
        // Entidades fora do lote (hover, seleção, texto…) só são desenhadas depois dos lotes; imagens raster vão
        // direto. Desenhá-las na hora fazia a imagem escaneada cobrir a linha em hover quando vinha depois dela.
        const deferred = [];
        entities.forEach((entity) => {
            if (hidden.has(entity.id)) return;
            const layer = layerOf(state.doc, entity.layer);
            if (layer && !layer.visible) return;
            const box = entityBox(entity);
            const selected = state.selection.has(entity.id);
            const hovered = state.hover === entity.id;

            // Sub-pixel culling adaptativo no zoom afastado (LOD):
            // Entidades que não estão selecionadas ou em hover e cujo envelope em tela é sub-pixel (<0.4px para vetores, <0.75px para texto)
            // são descartadas para evitar engasgos e saturação da fila de renderização.
            if (!selected && !hovered) {
                if (entity.type === 'text') {
                    const px = (entity.height || 2.5) * viewport.scale;
                    if (px < 0.75) return;
                } else if (entity.type === 'point') {
                    const p = entity.position ?? entity.point;
                    if (!p || !pointInBox(p, visible)) return;
                } else {
                    const screenW = (box.maxX - box.minX) * viewport.scale;
                    const screenH = (box.maxY - box.minY) * viewport.scale;
                    if (screenW < 0.4 && screenH < 0.4) return;
                }
            }

            const lineType = entity.lineType && entity.lineType !== 'bylayer' ? entity.lineType : layer?.lineType ?? 'CONTINUOUS';
            const lineWeight = entity.lineWeight ?? layer?.lineWeight ?? 0;
            const baseWidth = entity.constantWidth > 0
                ? Math.max(1, entity.constantWidth * viewport.scale)
                : (lineWeight > 0 ? Math.max(1, (lineWeight / 100) * 3.2) : 1.2);
            const style = {
                color: this.entityDisplayColor(entityColor(entity, state.doc)),
                width: selected ? baseWidth + 0.8 : hovered ? baseWidth + 0.6 : baseWidth,
                dashed: selected,
                dash: this.dashFor(lineType),
                alpha: 1,
            };

            // Batching para primitivas vetoriais regulares (linhas, círculos, arcos, polilinhas não selecionadas)
            if (!selected && !hovered && ['line', 'circle', 'arc', 'polyline'].includes(entity.type)) {
                const key = `${style.color}|${style.width}|${lineType}`;
                let batch = batches.get(key);
                if (!batch) {
                    batch = { color: style.color, width: style.width, dash: style.dash, curves: [] };
                    batches.set(key, batch);
                }
                const curves = entityCurves(entity);
                for (let c = 0; c < curves.length; c++) batch.curves.push(curves[c]);
            } else if (entity.type === 'image') {
                this.drawEntity(entity, style);
            } else {
                deferred.push([entity, style]);
            }
        });

        // Executa o desenho em lote agrupado por camada/estilo (reduzindo milhares de strokes para poucos)
        if (batches.size > 0) {
            batches.forEach((batch) => {
                ctx.save();
                ctx.strokeStyle = batch.color;
                ctx.lineWidth = batch.width;
                ctx.setLineDash(batch.dash ?? []);
                ctx.lineJoin = 'round';
                ctx.lineCap = 'round';
                ctx.beginPath();
                batch.curves.forEach((curve) => this.pathCurve(curve));
                ctx.stroke();
                ctx.restore();
            });
        }
        deferred.forEach(([entity, style]) => this.drawEntity(entity, style));

        (state.preview ?? []).forEach((entity) => {
            this.drawEntity(entity, { color: entity.color && entity.color !== 'bylayer' ? entity.color : this.theme.preview, width: 1.2, dashed: false, alpha: 0.9 });
        });

        state.selection.forEach((id) => {
            let entity = state.doc.entities.find((e) => e.id === id);
            if (state.activeGrip && state.activeGrip.entityId === id) {
                const previewEntity = (state.preview ?? []).find((e) => e.id === id);
                if (previewEntity) entity = previewEntity;
            }
            if (entity) this.drawGrips(entity, state.hoverGrip, state.activeGrip);
        });

        this.drawOrigin();

        if (state.tracking) this.drawTracking(state.tracking);
        if (state.rubber) this.drawRubber(state.rubber.from, state.rubber.to);
        if (state.window) this.drawWindow(state.window);
        if (state.snap) this.drawSnap(state.snap);
        if (state.showCrosshair && state.cursor) this.drawCrosshair(state.cursor, Boolean(state.snap), state.crosshairMode === 'point');
        if (state.collaborators && state.collaborators.length > 0) this.drawCollaborators(state.collaborators, state.doc);
        if (isExperimentalLxds) this.drawLxdsHeaderBadge();
        const isCdr = Boolean(state.doc?.sourceFormat === 'cdr' || /\.cdr$/i.test(state.doc?.name ?? ''));
        if (isCdr) this.drawCdrHeaderBadge();
        const isElmt = Boolean(state.doc?.sourceFormat === 'elmt' || /\.elmt$/i.test(state.doc?.name ?? ''));
        if (isElmt) this.drawElmtHeaderBadge();
        const isQet = Boolean(state.doc?.sourceFormat === 'qet' || /\.qet$/i.test(state.doc?.name ?? ''));
        if (isQet) this.drawQetHeaderBadge();
        ctx.restore();
    }

    drawGrid() {
        const { ctx, viewport } = this;
        const spacing = viewport.gridSpacing(60);
        const minor = spacing / 5;
        const box = viewport.visibleBox();
        const drawLines = (step, style) => {
            ctx.strokeStyle = style;
            ctx.lineWidth = 1;
            ctx.beginPath();
            const startX = Math.floor(box.minX / step) * step;
            const startY = Math.floor(box.minY / step) * step;
            const maxLines = 400;
            let count = 0;
            for (let x = startX; x <= box.maxX && count < maxLines; x += step, count += 1) {
                const s = viewport.worldToScreen({ x, y: 0 });
                ctx.moveTo(Math.round(s.x) + 0.5, 0);
                ctx.lineTo(Math.round(s.x) + 0.5, viewport.height);
            }
            count = 0;
            for (let y = startY; y <= box.maxY && count < maxLines; y += step, count += 1) {
                const s = viewport.worldToScreen({ x: 0, y });
                ctx.moveTo(0, Math.round(s.y) + 0.5);
                ctx.lineTo(viewport.width, Math.round(s.y) + 0.5);
            }
            ctx.stroke();
        };
        if (minor * viewport.scale >= 8) drawLines(minor, this.theme.grid);
        drawLines(spacing, this.theme.gridMajor);
    }

    drawAxes() {
        // Desativado: linhas infinitas que cortavam a tela inteira removidas.
        // O ponto 0,0 do desenho é indicado de forma limpa pelo ícone UCS estilo BricsCAD em drawOrigin().
    }

    // Ícone UCS na origem (0,0) do desenho — estilo clássico do BricsCAD (WCS):
    // Eixos ortogonais X (vermelho) e Y (verde) de tamanho fixo em pixels (~54px),
    // com caixa quadrada WCS na origem contendo a marca 'W', e rótulos 'X' e 'Y' nas pontas.
    drawOrigin() {
        const { ctx, viewport } = this;
        const o = viewport.worldToScreen({ x: 0, y: 0 });
        const armLength = 54;
        const boxSize = 12;

        if (o.x < -armLength - 30 || o.y < -armLength - 30 || o.x > viewport.width + armLength + 30 || o.y > viewport.height + armLength + 30) {
            return;
        }

        const ox = Math.round(o.x) + 0.5;
        const oy = Math.round(o.y) + 0.5;

        ctx.save();
        ctx.setLineDash([]);

        const colorX = this.theme.originX || '#e2564f';
        const colorY = this.theme.originY || '#4fc46b';
        const colorBox = this.theme.name === 'dark' ? 'rgba(255, 255, 255, 0.65)' : 'rgba(0, 0, 0, 0.60)';

        // 1. Caixa WCS na origem (situada no primeiro quadrante entre os eixos X e Y)
        ctx.lineWidth = 1;
        ctx.strokeStyle = colorBox;
        ctx.strokeRect(ox, oy - boxSize, boxSize, boxSize);

        // Marcação 'W' (World Coordinate System) centralizada na caixa WCS
        ctx.font = '8px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = colorBox;
        ctx.fillText('W', ox + boxSize / 2, oy - boxSize / 2);

        // 2. Eixo X (vermelho, horizontal para a direita)
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = colorX;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + armLength, oy);
        ctx.stroke();

        // Rótulo 'X'
        ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = colorX;
        ctx.fillText('X', ox + armLength + 5, oy);

        // 3. Eixo Y (verde, vertical para cima)
        ctx.strokeStyle = colorY;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox, oy - armLength);
        ctx.stroke();

        // Rótulo 'Y'
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = colorY;
        ctx.fillText('Y', ox, oy - armLength - 4);

        ctx.restore();
    }

    dashFor(lineType) {
        const def = LINETYPES[String(lineType ?? 'CONTINUOUS').toUpperCase()];
        if (!def || def.pattern.length === 0) return [];
        // Padrão em pixels fixos (legível em qualquer zoom), proporcional ao definido.
        const px = this.viewport.scale;
        const unit = Math.min(Math.max(px, 0.35), 1.2);
        return def.pattern.map((v) => Math.max(1.5, Math.abs(v === 0 ? 1.5 : v) * unit));
    }

    drawEntity(entity, style) {
        const { ctx } = this;
        ctx.save();
        ctx.globalAlpha = style.alpha ?? 1;
        ctx.strokeStyle = style.color;
        ctx.fillStyle = style.color;
        ctx.lineWidth = style.width ?? 1;
        ctx.setLineDash(style.dashed ? [6, 4] : style.dash ?? []);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        if(entity.type==='insert'){
            const box = entityBox(entity);
            const screenW = (box.maxX - box.minX) * this.viewport.scale;
            const screenH = (box.maxY - box.minY) * this.viewport.scale;
            if (!style.dashed && screenW < 0.4 && screenH < 0.4) return;
            expandInsert(entity).forEach(child=>{
                const layer=this.currentDoc?layerOf(this.currentDoc,child.layer):null;if(layer?.visible===false)return;
                const color=this.currentDoc?this.entityDisplayColor(entityColor(child,this.currentDoc)):style.color;
                const lineType=child.lineType&&child.lineType!=='bylayer'?child.lineType:layer?.lineType;
                const weight=child.lineWeight??layer?.lineWeight??0;
                this.drawEntity(child,{...style,color,dash:this.dashFor(lineType),width:weight>0?Math.max(1,weight/100*3.2):style.width});
            });
        }
        else if (entity.type === 'point') {
            this.drawPoint(entity, style);
        } else if (entity.type === 'text') {
            this.drawText(entity, style);
        } else if (entity.type === 'dimension') {
            this.drawDimension(entity, style);
        } else if (entity.type === 'ellipse') {
            this.drawEllipse(entity);
        } else if (entity.type === 'spline') {
            this.drawSpline(entity, style);
        } else if (entity.type === 'image') {
            this.drawImage(entity, style);
        } else if (entity.type === 'hatch') {
            this.drawHatch(entity, style);
        } else if (entity.type === 'terminal') {
            this.drawTerminal(entity, style);
        } else {
            ctx.beginPath();
            entityCurves(entity).forEach((curve) => this.pathCurve(curve));
            ctx.stroke();
        }
        ctx.restore();
    }

    drawPoint(entity, style) {
        const { ctx, viewport } = this;
        const pos = entity.position ?? entity.point;
        if (!pos) return;
        const s = viewport.worldToScreen(pos);
        const size = 4;
        ctx.beginPath();
        ctx.moveTo(s.x - size, s.y);
        ctx.lineTo(s.x + size, s.y);
        ctx.moveTo(s.x, s.y - size);
        ctx.lineTo(s.x, s.y + size);
        ctx.stroke();
    }

    pathCurve(curve) {
        const { ctx, viewport } = this;
        const scale = viewport.scale;
        const ox = viewport.originX;
        const oy = viewport.originY;
        if (curve.kind === 'segment') {
            ctx.moveTo(curve.a.x * scale + ox, -curve.a.y * scale + oy);
            ctx.lineTo(curve.b.x * scale + ox, -curve.b.y * scale + oy);
            return;
        }
        const cx = curve.center.x * scale + ox;
        const cy = -curve.center.y * scale + oy;
        const r = curve.radius * scale;
        if (curve.kind === 'circle') {
            ctx.moveTo(cx + r, cy);
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            return;
        }
        // Canvas usa Y para baixo: ângulo CCW no mundo vira CW na tela.
        const startX = (curve.center.x + Math.cos(curve.start) * curve.radius) * scale + ox;
        const startY = -(curve.center.y + Math.sin(curve.start) * curve.radius) * scale + oy;
        ctx.moveTo(startX, startY);
        ctx.arc(cx, cy, r, -curve.start, -curve.end, true);
    }

    drawEllipse(entity) {
        const { ctx, viewport } = this;
        const c = viewport.worldToScreen(entity.center);
        const majorLen = Math.hypot(entity.major.x, entity.major.y) * viewport.scale;
        const minorLen = majorLen * entity.ratio;
        const rotation = -Math.atan2(entity.major.y, entity.major.x);
        ctx.beginPath();
        if (ellipseIsFull(entity)) {
            ctx.ellipse(c.x, c.y, majorLen, minorLen, rotation, 0, Math.PI * 2);
        } else {
            // Canvas usa Y para baixo: parâmetros anti-horários viram horários.
            ctx.ellipse(c.x, c.y, majorLen, minorLen, rotation, -(entity.start ?? 0), -(entity.end ?? Math.PI * 2), true);
        }
        ctx.stroke();
    }

    drawSpline(entity, style) {
        const { ctx, viewport } = this;
        if (!entity._sampledPts) {
            entity._sampledPts = sampleSpline(ensureSplineGeometry(entity), 16);
        }
        const pts = entity._sampledPts;
        if (!pts || pts.length < 2) return;

        const scale = viewport.scale;
        const ox = viewport.originX;
        const oy = viewport.originY;

        ctx.beginPath();
        // Decimação espacial adaptativa (LOD): ao afastar o zoom, ignora pontos consecutivos com distância em tela < 1px
        const minStepSq = 1.0;
        let lastSx = pts[0].x * scale + ox;
        let lastSy = -pts[0].y * scale + oy;
        ctx.moveTo(lastSx, lastSy);

        const lastIdx = pts.length - 1;
        for (let i = 1; i <= lastIdx; i++) {
            const sx = pts[i].x * scale + ox;
            const sy = -pts[i].y * scale + oy;
            if (i === lastIdx) {
                ctx.lineTo(sx, sy);
            } else {
                const dx = sx - lastSx;
                const dy = sy - lastSy;
                if (dx * dx + dy * dy >= minStepSq) {
                    ctx.lineTo(sx, sy);
                    lastSx = sx;
                    lastSy = sy;
                }
            }
        }
        ctx.stroke();

        if (style.dashed && entity.fitPoints) {
            ctx.setLineDash([]);
            entity.fitPoints.forEach((p) => {
                const sx = p.x * scale + ox;
                const sy = -p.y * scale + oy;
                ctx.strokeRect(sx - 3, sy - 3, 6, 6);
            });
        }
    }

    drawImage(entity, style) {
        const { ctx, viewport } = this;
        const img = loadImage(entity.src, () => { this.needsRedraw = true; this.onImageReady?.(); });
        const corners = imageCorners(entity);
        const p0 = viewport.worldToScreen(corners[3]); // canto superior esquerdo em tela
        const w = entity.width * viewport.scale;
        const h = entity.height * viewport.scale;
        ctx.save();
        ctx.translate(p0.x, p0.y);
        ctx.rotate(-((entity.rotation ?? 0) * Math.PI) / 180);
        ctx.globalAlpha = (style.alpha ?? 1) * (entity.opacity ?? 1);
        if (img.complete && img.naturalWidth > 0) {
            if (entity.mirrored) {
                ctx.translate(w, 0);
                ctx.scale(-1, 1);
            }
            const c = entity.clip;
            if (c) {
                // Espelhada, a faixa visível [u0,u1] vem das colunas [1-u1, 1-u0] da imagem.
                const su = entity.mirrored ? 1 - c.u1 : c.u0;
                const nw = img.naturalWidth;
                const nh = img.naturalHeight;
                ctx.drawImage(img, su * nw, (1 - c.v1) * nh, (c.u1 - c.u0) * nw, (c.v1 - c.v0) * nh, su * w, (1 - c.v1) * h, (c.u1 - c.u0) * w, (c.v1 - c.v0) * h);
            } else {
                ctx.drawImage(img, 0, 0, w, h);
            }
        } else {
            ctx.strokeRect(0, 0, w, h);
        }
        ctx.restore();
        if (style.dashed) {
            ctx.beginPath();
            imageVisibleCorners(entity).forEach((c, i) => {
                const s = viewport.worldToScreen(c);
                if (i === 0) ctx.moveTo(s.x, s.y);
                else ctx.lineTo(s.x, s.y);
            });
            ctx.closePath();
            ctx.stroke();
        }
    }

    drawHatch(entity, style) {
        const { ctx, viewport } = this;
        const box = hatchBox(entity);
        const a = viewport.worldToScreen({ x: box.minX, y: box.minY });
        const b = viewport.worldToScreen({ x: box.maxX, y: box.maxY });
        const left = Math.max(0, Math.min(a.x, b.x));
        const right = Math.min(viewport.width, Math.max(a.x, b.x));
        const top = Math.max(0, Math.min(a.y, b.y));
        const bottom = Math.min(viewport.height, Math.max(a.y, b.y));
        if (right <= left || bottom <= top || (right - left < 1.5 && bottom - top < 1.5)) return;

        const path = new Path2D();
        hatchPath(entity, (p) => viewport.worldToScreen(p), path);
        const pattern = HATCH_PATTERNS[entity.pattern] ?? HATCH_PATTERNS.ANSI31;
        ctx.save();
        if (pattern.lines.length === 0) {
            ctx.globalAlpha = (style.alpha ?? 1) * (entity.opacity ?? 0.35);
            ctx.fill(path, 'evenodd');
        } else {
            ctx.clip(path, 'evenodd');
            const spacingPx = Math.max((entity.spacing ?? 3) * viewport.scale, 2);
            // Mesma âncora da exportação: a origem do desenho, para hachuras vizinhas casarem.
            const anchor = viewport.worldToScreen({ x: 0, y: 0 });
            const corners = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
                .map((p) => ({ x: p.x - anchor.x, y: p.y - anchor.y }));
            ctx.lineWidth = Math.max(0.8, (style.width ?? 1) * 0.7);
            ctx.setLineDash(pattern.lines[0].dots ? [1, Math.max(2, spacingPx - 1)] : []);
            pattern.lines.forEach((line) => {
                const angle = -(((entity.angle ?? 45) + line.angle) * Math.PI) / 180;
                const dir = { x: Math.cos(angle), y: Math.sin(angle) };
                const normal = { x: -dir.y, y: dir.x };
                const along = corners.map((p) => p.x * dir.x + p.y * dir.y);
                const across = corners.map((p) => p.x * normal.x + p.y * normal.y);
                const from = Math.min(...along);
                const to = Math.max(...along);
                const range=hatchLineRange(Math.min(...across),Math.max(...across),spacingPx);
                ctx.beginPath();
                for(let step=0;step<range.count;step++){
                    const off=(range.first+step)*spacingPx;
                    ctx.moveTo(anchor.x + normal.x * off + dir.x * from, anchor.y + normal.y * off + dir.y * from);
                    ctx.lineTo(anchor.x + normal.x * off + dir.x * to, anchor.y + normal.y * off + dir.y * to);
                }
                ctx.stroke();
            });
        }
        ctx.restore();
        if (style.dashed) {
            ctx.setLineDash([6, 4]);
            ctx.stroke(path);
        }
    }

    drawDimension(entity, style) {
        const { ctx, viewport } = this;
        const g = dimensionGeometry(entity, this.currentDimStyle);
        ctx.beginPath();
        g.segments.forEach((seg) => {
            const a = viewport.worldToScreen(seg.a);
            const b = viewport.worldToScreen(seg.b);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
        });
        if (g.arcs) {
            g.arcs.forEach((arc) => {
                this.pathCurve({ kind: 'arc', center: arc.center, radius: arc.radius, start: arc.startAngle, end: arc.endAngle });
            });
        }
        ctx.stroke();
        ctx.setLineDash([]);
        g.arrows.forEach((tri) => {
            ctx.beginPath();
            tri.forEach((p, i) => {
                const s = viewport.worldToScreen(p);
                if (i === 0) ctx.moveTo(s.x, s.y);
                else ctx.lineTo(s.x, s.y);
            });
            ctx.closePath();
            ctx.fill();
        });
        g.texts.forEach((t) => this.drawText(t, { ...style, dashed: false }));
    }

    drawText(entity, style) {
        const { ctx, viewport } = this;
        const px = (entity.height || 2.5) * viewport.scale;
        if (px < 0.75) return;
        const p = viewport.worldToScreen(entity.position);
        if (px < 3.5) {
            // Text Greeking (padrão CAD): abaixo de 3.5px os glifos são ilegíveis.
            // Desenha representação geométrica rápida sem invocar o motor de fontes e medições do canvas.
            const len = typeof entity.text === 'string' ? entity.text.length : 4;
            const w = Math.max(len * px * 0.6, 2);
            ctx.fillStyle = style.color;
            ctx.fillRect(p.x, p.y - px * 0.8, w, Math.max(px * 0.7, 0.8));
            return;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(-((entity.rotation ?? 0) * Math.PI) / 180);
        if (entity.mirrored) ctx.scale(-1, 1);
        ctx.font = canvasFont(entity, px);
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = style.color;

        const rawLines = String(entity.text ?? '').split('\n');
        let lines = rawLines;
        if (entity.boxWidth && entity.boxWidth > 0) {
            const boxWidthPx = entity.boxWidth * viewport.scale;
            lines = [];
            for (const rawLine of rawLines) {
                const words = rawLine.split(' ');
                let currentLine = '';
                for (let i = 0; i < words.length; i++) {
                    const word = words[i];
                    if (!currentLine) {
                        currentLine = word;
                    } else {
                        const testLine = currentLine + ' ' + word;
                        const testW = ctx.measureText(testLine).width;
                        if (testW <= boxWidthPx) {
                            currentLine = testLine;
                        } else {
                            lines.push(currentLine);
                            currentLine = word;
                        }
                    }
                }
                if (currentLine) {
                    lines.push(currentLine);
                }
            }
        }

        const halign = entity.halign ?? 'left';
        const valign = entity.valign ?? (entity.attachmentPoint ? 'top' : 'baseline');
        const lineSpacing = px * 1.35;
        const totalHeight = px + (lines.length - 1) * lineSpacing;

        const baselineOffset = px * 0.8;
        let startY = 0;
        if (valign === 'top') {
            startY = baselineOffset;
        } else if (valign === 'middle') {
            startY = -totalHeight / 2 + baselineOffset;
        } else if (valign === 'bottom') {
            startY = -totalHeight + baselineOffset;
        } else {
            startY = 0;
        }

        const measuredWidths = lines.map((l) => ctx.measureText(l).width);
        const maxMeasuredWidth = Math.max(...measuredWidths, 1);

        let anchorX = 0;
        if (entity.boxWidth && entity.boxWidth > 0) {
            const w = entity.boxWidth * viewport.scale;
            const attach = entity.attachmentPoint || 1;
            const attachCol = (attach - 1) % 3; // 0: left, 1: center, 2: right
            const boxLeft = attachCol === 0 ? 0 : (attachCol === 1 ? -w / 2 : -w);
            if (halign === 'center') {
                anchorX = boxLeft + w / 2;
            } else if (halign === 'right') {
                anchorX = boxLeft + w;
            } else {
                anchorX = boxLeft;
            }
        }

        lines.forEach((line, index) => {
            const lineWidth = measuredWidths[index];
            let lineX = anchorX;
            if (halign === 'center') {
                lineX = anchorX - lineWidth / 2;
            } else if (halign === 'right') {
                lineX = anchorX - lineWidth;
            }
            const lineY = startY + index * lineSpacing;
            ctx.fillText(line, lineX, lineY);
        });

        if (style.dashed) {
            let boxX = anchorX;
            if (halign === 'center') boxX = anchorX - maxMeasuredWidth / 2;
            else if (halign === 'right') boxX = anchorX - maxMeasuredWidth;

            let boxY = 0;
            if (valign === 'top') boxY = 0;
            else if (valign === 'middle') boxY = -totalHeight / 2;
            else if (valign === 'bottom') boxY = -totalHeight;
            else boxY = -px;

            ctx.strokeRect(boxX, boxY, maxMeasuredWidth, totalHeight);
        }
        ctx.restore();
    }

    drawGrips(entity, hoverGrip, activeGrip) {
        const { ctx, viewport } = this;
        const grips = getEntityGrips(entity);
        ctx.save();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        const seen = new Set();
        grips.forEach((g) => {
            const s = viewport.worldToScreen(g.point);
            const key = `${Math.round(s.x)}:${Math.round(s.y)}`;
            if (seen.has(key)) return;
            seen.add(key);
            const isActive = Boolean(activeGrip && activeGrip.entityId === g.entityId && activeGrip.type === g.type && activeGrip.index === g.index);
            const isHover = !isActive && Boolean(hoverGrip && (hoverGrip.id === g.id || Math.hypot(g.point.x - hoverGrip.point.x, g.point.y - hoverGrip.point.y) < 1e-4));
            const size = isActive || isHover ? 8 : 6;
            if (isActive) {
                ctx.fillStyle = '#ff3b30';
                ctx.strokeStyle = '#ffffff';
            } else if (isHover) {
                ctx.fillStyle = '#ff9500';
                ctx.strokeStyle = '#ffffff';
            } else {
                ctx.fillStyle = this.theme.gripFill;
                ctx.strokeStyle = this.theme.grip;
            }
            ctx.fillRect(s.x - size / 2, s.y - size / 2, size, size);
            ctx.strokeRect(s.x - size / 2 + 0.5, s.y - size / 2 + 0.5, size - 1, size - 1);
        });
        ctx.restore();
    }

    drawTracking({ points, lines }) {
        const { ctx, viewport } = this;
        ctx.save();
        ctx.setLineDash([]);
        ctx.strokeStyle = this.theme.tracking;
        ctx.lineWidth = 1;
        (points ?? []).forEach((tp) => {
            const s = viewport.worldToScreen(tp.point);
            ctx.beginPath();
            ctx.moveTo(s.x - 5, s.y);
            ctx.lineTo(s.x + 5, s.y);
            ctx.moveTo(s.x, s.y - 5);
            ctx.lineTo(s.x, s.y + 5);
            ctx.stroke();
        });
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = this.theme.trackingLine;
        const reach = viewport.pixelsToWorld(viewport.width + viewport.height) * 2;
        (lines ?? []).forEach((line) => {
            ctx.beginPath();
            if (line.kind === 'circle') {
                const c = viewport.worldToScreen(line.center);
                ctx.arc(c.x, c.y, line.radius * viewport.scale, 0, Math.PI * 2);
            } else {
                const dir = { x: Math.cos(line.angle), y: Math.sin(line.angle) };
                const a = line.kind === 'ray' ? line.origin : { x: line.origin.x - dir.x * reach, y: line.origin.y - dir.y * reach };
                const b = { x: line.origin.x + dir.x * reach, y: line.origin.y + dir.y * reach };
                const sa = viewport.worldToScreen(a);
                const sb = viewport.worldToScreen(b);
                ctx.moveTo(sa.x, sa.y);
                ctx.lineTo(sb.x, sb.y);
            }
            ctx.stroke();
        });
        ctx.restore();
    }

    drawRubber(from, to) {
        const { ctx, viewport } = this;
        const a = viewport.worldToScreen(from);
        const b = viewport.worldToScreen(to);
        ctx.save();
        ctx.strokeStyle = this.theme.rubber;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.restore();
    }

    drawWindow({ a, b, crossing }) {
        const { ctx, viewport } = this;
        const p = viewport.worldToScreen(a);
        const q = viewport.worldToScreen(b);
        ctx.save();
        ctx.fillStyle = crossing ? this.theme.crossingFill : this.theme.windowFill;
        ctx.strokeStyle = crossing ? this.theme.crossingStroke : this.theme.windowStroke;
        ctx.lineWidth = 1;
        ctx.setLineDash(crossing ? [5, 3] : []);
        const x = Math.min(p.x, q.x);
        const y = Math.min(p.y, q.y);
        const w = Math.abs(q.x - p.x);
        const h = Math.abs(q.y - p.y);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        ctx.restore();
    }

    drawSnap({ mode, point }) {
        const { ctx, viewport } = this;
        const s = viewport.worldToScreen(point);
        const r = 7;
        ctx.save();
        ctx.strokeStyle = this.theme.snap;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        switch (mode) {
            case 'end':
                ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
                break;
            case 'mid':
                ctx.moveTo(s.x, s.y - r);
                ctx.lineTo(s.x + r, s.y + r);
                ctx.lineTo(s.x - r, s.y + r);
                ctx.closePath();
                break;
            case 'cen':
                ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
                break;
            case 'int':
                ctx.moveTo(s.x - r, s.y - r);
                ctx.lineTo(s.x + r, s.y + r);
                ctx.moveTo(s.x + r, s.y - r);
                ctx.lineTo(s.x - r, s.y + r);
                break;
            case 'per':
                ctx.moveTo(s.x - r, s.y - r);
                ctx.lineTo(s.x - r, s.y + r);
                ctx.lineTo(s.x + r, s.y + r);
                ctx.moveTo(s.x - r, s.y);
                ctx.lineTo(s.x, s.y);
                ctx.lineTo(s.x, s.y + r);
                break;
            case 'qua':
                ctx.moveTo(s.x, s.y - r);
                ctx.lineTo(s.x + r, s.y);
                ctx.lineTo(s.x, s.y + r);
                ctx.lineTo(s.x - r, s.y);
                ctx.closePath();
                break;
            case 'tan':
                ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
                ctx.moveTo(s.x - r, s.y - r);
                ctx.lineTo(s.x + r, s.y - r);
                break;
            case 'nea':
                // Ampulheta (Nearest / Mais próximo no padrão AutoCAD/BricsCAD)
                ctx.moveTo(s.x - r, s.y - r);
                ctx.lineTo(s.x + r, s.y - r);
                ctx.lineTo(s.x - r, s.y + r);
                ctx.lineTo(s.x + r, s.y + r);
                ctx.closePath();
                break;
            case 'nod':
                // Nó / Terminal (Círculo com cruz interna)
                ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
                ctx.moveTo(s.x - r * 0.7, s.y - r * 0.7);
                ctx.lineTo(s.x + r * 0.7, s.y + r * 0.7);
                ctx.moveTo(s.x + r * 0.7, s.y - r * 0.7);
                ctx.lineTo(s.x - r * 0.7, s.y + r * 0.7);
                break;
            case 'trk':
            case 'ext':
                ctx.strokeStyle = this.theme.tracking;
                ctx.moveTo(s.x - r, s.y - r);
                ctx.lineTo(s.x + r, s.y + r);
                ctx.moveTo(s.x + r, s.y - r);
                ctx.lineTo(s.x - r, s.y + r);
                break;
            case 'trkint':
                ctx.strokeStyle = this.theme.tracking;
                ctx.moveTo(s.x - r, s.y - r);
                ctx.lineTo(s.x + r, s.y + r);
                ctx.moveTo(s.x + r, s.y - r);
                ctx.lineTo(s.x - r, s.y + r);
                ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
                break;
            default:
                ctx.moveTo(s.x - r, s.y - r);
                ctx.lineTo(s.x + r, s.y + r);
                ctx.moveTo(s.x + r, s.y - r);
                ctx.lineTo(s.x - r, s.y + r);
                ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
        }
        ctx.stroke();
        ctx.restore();
    }

    // Mira no padrão do BricsCAD: eixos X vermelho e Y verde, sempre iguais; pedindo ponto, some o quadrado de seleção.
    drawCrosshair(cursor, snapped, pointMode = false) {
        const { ctx, viewport } = this;
        const s = viewport.worldToScreen(cursor);
        ctx.save();
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        const size = 32;
        ctx.strokeStyle = this.theme.crosshairX;
        ctx.beginPath();
        ctx.moveTo(s.x - size, s.y + 0.5);
        ctx.lineTo(s.x + size, s.y + 0.5);
        ctx.stroke();
        ctx.strokeStyle = this.theme.crosshairY;
        ctx.beginPath();
        ctx.moveTo(s.x + 0.5, s.y - size);
        ctx.lineTo(s.x + 0.5, s.y + size);
        ctx.stroke();
        if (!snapped && !pointMode) {
            ctx.strokeStyle = this.theme.crosshair;
            ctx.strokeRect(s.x - 4.5, s.y - 4.5, 9, 9);
        }
        ctx.restore();
    }

    drawLxdsBackgroundWatermark() {
        const { ctx, viewport } = this;
        ctx.save();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        ctx.save();
        ctx.rotate((-25 * Math.PI) / 180);
        ctx.font = '700 22px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = this.theme.name === 'light' ? 'rgba(215, 120, 0, 0.08)' : 'rgba(255, 175, 20, 0.07)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const stepX = 460;
        const stepY = 160;
        const diag = Math.hypot(viewport.width, viewport.height) * 1.5;
        const text = tr('FORMATO .LXDS • VISUALIZAÇÃO EXPERIMENTAL');
        for (let y = -diag; y < diag; y += stepY) {
            for (let x = -diag; x < diag; x += stepX) {
                ctx.fillText(text, x, y);
            }
        }
        ctx.restore();
        ctx.restore();
    }

    drawLxdsHeaderBadge() {
        const { ctx, viewport } = this;
        ctx.save();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        const badgeText = tr('⚠️ ARQUIVO .LXDS — VISUALIZAÇÃO EXPERIMENTAL (ENG. REVERSA) • CONFIRA MEDIDAS ANTES DE CORTAR');
        ctx.font = '600 11px system-ui, -apple-system, sans-serif';
        const textWidth = ctx.measureText(badgeText).width;
        const badgeW = textWidth + 28;
        const badgeH = 26;
        const badgeX = (viewport.width - badgeW) / 2;
        const badgeY = 10;

        ctx.fillStyle = this.theme.name === 'light' ? 'rgba(255, 243, 205, 0.94)' : 'rgba(38, 25, 6, 0.88)';
        ctx.strokeStyle = this.theme.name === 'light' ? 'rgba(220, 130, 0, 0.65)' : 'rgba(255, 175, 20, 0.55)';
        ctx.lineWidth = 1;

        const r = 6;
        ctx.beginPath();
        ctx.moveTo(badgeX + r, badgeY);
        ctx.arcTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + badgeH, r);
        ctx.arcTo(badgeX + badgeW, badgeY + badgeH, badgeX, badgeY + badgeH, r);
        ctx.arcTo(badgeX, badgeY + badgeH, badgeX, badgeY, r);
        ctx.arcTo(badgeX, badgeY, badgeX + badgeW, badgeY, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = this.theme.name === 'light' ? '#9a5800' : '#f5a623';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, viewport.width / 2, badgeY + badgeH / 2);
        ctx.restore();
    }

    drawCdrHeaderBadge() {
        const { ctx, viewport } = this;
        ctx.save();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        const badgeText = tr('🎨 ARQUIVO .CDR (COREL) — MODO VISUALIZAÇÃO E MEDIÇÃO • USE COTAS OU DESENHE VETORES');
        ctx.font = '600 11px system-ui, -apple-system, sans-serif';
        const textWidth = ctx.measureText(badgeText).width;
        const badgeW = textWidth + 28;
        const badgeH = 26;
        const badgeX = (viewport.width - badgeW) / 2;
        const badgeY = 10;

        ctx.fillStyle = this.theme.name === 'light' ? 'rgba(224, 242, 254, 0.94)' : 'rgba(8, 47, 73, 0.88)';
        ctx.strokeStyle = this.theme.name === 'light' ? 'rgba(14, 165, 233, 0.65)' : 'rgba(56, 189, 248, 0.55)';
        ctx.lineWidth = 1;

        const r = 6;
        ctx.beginPath();
        ctx.moveTo(badgeX + r, badgeY);
        ctx.arcTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + badgeH, r);
        ctx.arcTo(badgeX + badgeW, badgeY + badgeH, badgeX, badgeY + badgeH, r);
        ctx.arcTo(badgeX, badgeY + badgeH, badgeX, badgeY, r);
        ctx.arcTo(badgeX, badgeY, badgeX + badgeW, badgeY, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = this.theme.name === 'light' ? '#0369a1' : '#38bdf8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, viewport.width / 2, badgeY + badgeH / 2);
        ctx.restore();
    }

    drawTerminal(entity, style) {
        const { ctx, viewport } = this;
        const pt = viewport.worldToScreen(entity.position);
        const r = 4;

        ctx.save();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fillStyle = style.selected ? '#38bdf8' : (entity.color || '#ef4444');
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        const dir = (entity.orientation || 'n').toLowerCase();
        let dx = 0, dy = 0;
        if (dir === 'n') dy = -1;
        else if (dir === 's') dy = 1;
        else if (dir === 'e') dx = 1;
        else if (dir === 'w') dx = -1;

        const tickLen = 8;
        ctx.beginPath();
        ctx.moveTo(pt.x + dx * r, pt.y + dy * r);
        ctx.lineTo(pt.x + dx * (r + tickLen), pt.y + dy * (r + tickLen));
        ctx.strokeStyle = style.selected ? '#38bdf8' : (entity.color || '#ef4444');
        ctx.lineWidth = 2;
        ctx.stroke();

        if (entity.name) {
            ctx.font = '600 10px monospace';
            ctx.fillStyle = this.theme.text || '#ffffff';
            ctx.textAlign = dx < 0 ? 'right' : (dx > 0 ? 'left' : 'center');
            ctx.textBaseline = dy < 0 ? 'bottom' : (dy > 0 ? 'top' : 'middle');
            const textOffsetX = dx === 0 ? 0 : dx * (r + tickLen + 4);
            const textOffsetY = dy === 0 ? 0 : dy * (r + tickLen + 4);
            ctx.fillText(String(entity.name), pt.x + textOffsetX, pt.y + textOffsetY);
        }
        ctx.restore();
    }

    drawElmtHeaderBadge() {
        const { ctx, viewport } = this;
        ctx.save();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        const badgeText = tr('⚡ SÍMBOLO ELÉTRICO .ELMT (QELECTROTECH) — MODO EDIÇÃO DE COMPONENTE E TERMINAIS');
        ctx.font = '600 11px system-ui, -apple-system, sans-serif';
        const textWidth = ctx.measureText(badgeText).width;
        const badgeW = textWidth + 28;
        const badgeH = 26;
        const badgeX = (viewport.width - badgeW) / 2;
        const badgeY = 10;

        ctx.fillStyle = this.theme.name === 'light' ? 'rgba(254, 243, 199, 0.94)' : 'rgba(69, 26, 3, 0.88)';
        ctx.strokeStyle = this.theme.name === 'light' ? 'rgba(245, 158, 11, 0.65)' : 'rgba(251, 191, 36, 0.55)';
        ctx.lineWidth = 1;

        const r = 6;
        ctx.beginPath();
        ctx.moveTo(badgeX + r, badgeY);
        ctx.arcTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + badgeH, r);
        ctx.arcTo(badgeX + badgeW, badgeY + badgeH, badgeX, badgeY + badgeH, r);
        ctx.arcTo(badgeX, badgeY + badgeH, badgeX, badgeY, r);
        ctx.arcTo(badgeX, badgeY, badgeX + badgeW, badgeY, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = this.theme.name === 'light' ? '#b45309' : '#fef08a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, viewport.width / 2, badgeY + badgeH / 2);
        ctx.restore();
    }

    drawQetHeaderBadge() {
        const { ctx, viewport } = this;
        ctx.save();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        const badgeText = tr('⚡ PROJETO ELÉTRICO .QET (QELECTROTECH) — ESQUEMA & CHICOTE INDUSTRIAL');
        ctx.font = '600 11px system-ui, -apple-system, sans-serif';
        const textWidth = ctx.measureText(badgeText).width;
        const badgeW = textWidth + 28;
        const badgeH = 26;
        const badgeX = (viewport.width - badgeW) / 2;
        const badgeY = 10;

        ctx.fillStyle = this.theme.name === 'light' ? 'rgba(224, 242, 254, 0.94)' : 'rgba(8, 47, 73, 0.88)';
        ctx.strokeStyle = this.theme.name === 'light' ? 'rgba(14, 165, 233, 0.65)' : 'rgba(56, 189, 248, 0.55)';
        ctx.lineWidth = 1;

        const r = 6;
        ctx.beginPath();
        ctx.moveTo(badgeX + r, badgeY);
        ctx.arcTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + badgeH, r);
        ctx.arcTo(badgeX + badgeW, badgeY + badgeH, badgeX, badgeY + badgeH, r);
        ctx.arcTo(badgeX, badgeY + badgeH, badgeX, badgeY, r);
        ctx.arcTo(badgeX, badgeY, badgeX + badgeW, badgeY, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = this.theme.name === 'light' ? '#0369a1' : '#bae6fd';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, viewport.width / 2, badgeY + badgeH / 2);
        ctx.restore();
    }

    drawCollaborators(collaborators, doc) {
        if (!Array.isArray(collaborators) || collaborators.length === 0) return;
        const { ctx, viewport } = this;

        collaborators.forEach((collab) => {
            const user = collab.user || {};
            const color = user.color || '#38bdf8';

            // 1. Destaque de Seleção Remota (caixa delimitadora pontilhada na cor do operador)
            if (Array.isArray(collab.selection) && collab.selection.length > 0 && doc?.entities) {
                collab.selection.forEach((id) => {
                    const entity = doc.entities.find((e) => e.id === id);
                    if (entity) {
                        const box = entityBox(entity);
                        if (boxesIntersect(box, viewport.visibleBox())) {
                            const pMin = viewport.worldToScreen({ x: box.minX, y: box.maxY });
                            const pMax = viewport.worldToScreen({ x: box.maxX, y: box.minY });
                            const pad = 4;
                            const w = Math.max(1, pMax.x - pMin.x + pad * 2);
                            const h = Math.max(1, pMax.y - pMin.y + pad * 2);

                            ctx.save();
                            ctx.strokeStyle = color;
                            ctx.lineWidth = 1.4;
                            ctx.setLineDash([4, 3]);
                            ctx.strokeRect(pMin.x - pad, pMin.y - pad, w, h);
                            ctx.restore();
                        }
                    }
                });
            }

            // 2. Cursor Remoto Estilo Figma no Espaço de Tela
            if (collab.cursor && typeof collab.cursor.x === 'number' && typeof collab.cursor.y === 'number') {
                const pt = viewport.worldToScreen(collab.cursor);
                if (pt.x < -100 || pt.x > viewport.width + 100 || pt.y < -100 || pt.y > viewport.height + 100) {
                    return;
                }

                ctx.save();
                ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

                // Desenha a seta do cursor apontando para pt
                ctx.beginPath();
                ctx.moveTo(pt.x, pt.y);
                ctx.lineTo(pt.x, pt.y + 14);
                ctx.lineTo(pt.x + 3.5, pt.y + 11.5);
                ctx.lineTo(pt.x + 8.5, pt.y + 16.5);
                ctx.lineTo(pt.x + 10.5, pt.y + 14.5);
                ctx.lineTo(pt.x + 5.5, pt.y + 9.5);
                ctx.lineTo(pt.x + 10, pt.y + 9.5);
                ctx.closePath();

                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.stroke();

                // Pílula com o nome do operador e ferramenta ativa
                const name = user.name || 'Colega';
                const toolText = collab.activeTool ? ` • ${collab.activeTool}` : '';
                const tagText = `${name}${toolText}`;

                ctx.font = '600 10px system-ui, -apple-system, sans-serif';
                const metrics = ctx.measureText(tagText);
                const tagW = metrics.width + 12;
                const tagH = 18;
                const tagX = pt.x + 8;
                const tagY = pt.y + 16;
                const r = 4;

                ctx.beginPath();
                ctx.moveTo(tagX + r, tagY);
                ctx.arcTo(tagX + tagW, tagY, tagX + tagW, tagY + tagH, r);
                ctx.arcTo(tagX + tagW, tagY + tagH, tagX, tagY + tagH, r);
                ctx.arcTo(tagX, tagY + tagH, tagX, tagY, r);
                ctx.arcTo(tagX, tagY, tagX + tagW, tagY, r);
                ctx.closePath();

                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 0.8;
                ctx.stroke();

                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(tagText, tagX + 6, tagY + tagH / 2);

                ctx.restore();
            }
        });
    }
}

