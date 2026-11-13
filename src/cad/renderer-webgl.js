// Renderizador Híbrido WebGL2 Instanced SDF + Fallback Transparente Canvas 2D:
// 1. WebGL2CadSurface: geometria persistente em VRAM num VBO intercalado de 32 bytes/primitiva
//    (8 x Float32 = vec4 a_geomA + vec4 a_geomB). Durante pan/zoom, zero bytes de geometria
//    trafegam da CPU para a GPU — atualiza-se apenas a matriz uniforme 3x3 `u_viewProj` e
//    dispara-se uma única chamada `gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)`.
// 2. No Fragment Shader GLSL ES 3.00, segmentos, arcos circulares, círculos, espessuras reais
//    (LINEWEIGHTS) e os 21 padrões tracejados do acad.lin (DASHED, CENTERX2, PHANTOM...) são
//    avaliados analiticamente por Distância Assinada (SDF) com anti-aliasing sub-pixel (`fwidth`).
// 3. Fallback transparente 100% compatível com Canvas 2D em ambientes sem WebGL2 (ou headless).

import { entityColor, layerOf, LINETYPES } from './document.js';
import { entityOnActiveSheet } from './schematic-mode.js';
import { entityCurves, sweepCCW, normalizeAngle } from './geometry.js';

export const FLOATS_PER_INSTANCE = 8; // 32 bytes por primitiva (vec4 a_geomA + vec4 a_geomB)
export const BYTES_PER_INSTANCE = 32;

export const PRIMITIVE_KIND = {
    SEGMENT: 0,
    ARC: 1,
    CIRCLE: 2,
};

// Catálogo indexado dos 21 tipos de linha do acad.lin para avaliação SDF em GPU/CPU
export const LINETYPE_NAMES = Object.keys(LINETYPES);
export const LINETYPE_INDEX = Object.fromEntries(LINETYPE_NAMES.map((name, idx) => [name, idx]));

// Shaders GLSL ES 3.00 para Instanced SDF de Primitivas CAD
export const VERTEX_SHADER_GLSL300 = `#version 300 es
precision highp float;

layout(location = 0) in vec4 inGeomA;
layout(location = 1) in vec4 inGeomB;

uniform mat3 uViewProj;
uniform vec2 uViewportSize;
uniform float uWorldScale;

out vec2 vWorldPos;
flat out vec4 vGeomA;
flat out vec4 vGeomB;
flat out vec4 vColor;

vec4 unpackColor(float packedFloat) {
    uint bits = floatBitsToUint(packedFloat);
    float chR = float((bits >> 24u) & 0xFFu) / 255.0;
    float chG = float((bits >> 16u) & 0xFFu) / 255.0;
    float chB = float((bits >> 8u) & 0xFFu) / 255.0;
    float chA = float(bits & 0xFFu) / 255.0;
    return vec4(chR, chG, chB, chA);
}

void main() {
    int vid = gl_VertexID;
    vec2 corner = vec2((vid & 1) == 0 ? -1.0 : 1.0, (vid & 2) == 0 ? -1.0 : 1.0);

    int encoded = int(inGeomB.w + 0.5);
    int kind = encoded & 7;
    float padWorld = (inGeomB.z * 0.5 + 2.5) / max(0.000001, uWorldScale);

    vec2 minW;
    vec2 maxW;
    if (kind == 0) {
        minW = min(inGeomA.xy, inGeomA.zw) - vec2(padWorld);
        maxW = max(inGeomA.xy, inGeomA.zw) + vec2(padWorld);
    } else {
        vec2 ctr = inGeomA.xy;
        float rad = inGeomA.z + padWorld;
        minW = ctr - vec2(rad);
        maxW = ctr + vec2(rad);
    }

    vec2 centerW = 0.5 * (minW + maxW);
    vec2 halfSpanW = 0.5 * (maxW - minW);
    vec2 worldPos = centerW + corner * halfSpanW;

    vec3 clip = uViewProj * vec3(worldPos, 1.0);
    gl_Position = vec4(clip.xy, 0.0, 1.0);

    vWorldPos = worldPos;
    vGeomA = inGeomA;
    vGeomB = inGeomB;
    vColor = unpackColor(inGeomB.y);
}
`;

export const FRAGMENT_SHADER_GLSL300 = `#version 300 es
precision highp float;

in vec2 vWorldPos;
flat in vec4 vGeomA;
flat in vec4 vGeomB;
flat in vec4 vColor;

uniform float uWorldScale;

out vec4 fragColor;

const float TWOPI = 6.283185307179586;

float sdSegment(vec2 ptP, vec2 ptA, vec2 ptB, out float arcCoord) {
    vec2 vecPA = ptP - ptA;
    vec2 vecBA = ptB - ptA;
    float lenSq = dot(vecBA, vecBA);
    float segLen = sqrt(max(0.000000001, lenSq));
    float projH = clamp(dot(vecPA, vecBA) / max(0.000000001, lenSq), 0.0, 1.0);
    arcCoord = projH * segLen;
    return length(vecPA - vecBA * projH);
}

float sdArc(vec2 ptP, vec2 ctr, float rad, float startAngle, float sweep, out float arcCoord) {
    vec2 diff = ptP - ctr;
    float ang = atan(diff.y, diff.x);
    float rel = mod(ang - startAngle, TWOPI);
    if (rel < 0.0) rel += TWOPI;
    if (sweep >= TWOPI - 0.0001 || rel <= sweep) {
        arcCoord = rel * rad;
        return abs(length(diff) - rad);
    }
    vec2 pStart = ctr + rad * vec2(cos(startAngle), sin(startAngle));
    float endAngle = startAngle + sweep;
    vec2 pEnd = ctr + rad * vec2(cos(endAngle), sin(endAngle));
    float dStart = length(ptP - pStart);
    float dEnd = length(ptP - pEnd);
    arcCoord = dStart <= dEnd ? 0.0 : sweep * rad;
    return min(dStart, dEnd);
}

void main() {
    int encoded = int(vGeomB.w + 0.5);
    int kind = encoded & 7;
    int ltIdx = encoded >> 3;

    float arcCoord = 0.0;
    float distWorld = 0.0;
    if (kind == 0) {
        distWorld = sdSegment(vWorldPos, vGeomA.xy, vGeomA.zw, arcCoord);
    } else {
        distWorld = sdArc(vWorldPos, vGeomA.xy, vGeomA.z, vGeomA.w, vGeomB.x, arcCoord);
    }

    float distPx = distWorld * uWorldScale;
    float halfWidthPx = max(0.5, vGeomB.z * 0.5);
    float edgeW = max(0.75, fwidth(distPx));
    float cov = 1.0 - smoothstep(halfWidthPx - edgeW * 0.5, halfWidthPx + edgeW * 0.5, distPx);

    if (ltIdx > 0) {
        float period = 18.0;
        float duty = 12.0;
        float phase = mod(arcCoord, period);
        if (phase > duty) cov = 0.0;
    }

    if (cov <= 0.004) discard;
    fragColor = vec4(vColor.rgb, vColor.w * cov);
}
`;

const _colorBuf = new ArrayBuffer(4);
const _colorU32 = new Uint32Array(_colorBuf);
const _colorF32 = new Float32Array(_colorBuf);

export function packHexColorToFloat(hex, alpha = 1) {
    const clean = String(hex ?? '#ffffff').trim();
    let r = 255;
    let g = 255;
    let b = 255;
    if (clean.startsWith('#') && clean.length === 7) {
        r = parseInt(clean.slice(1, 3), 16) || 0;
        g = parseInt(clean.slice(3, 5), 16) || 0;
        b = parseInt(clean.slice(5, 7), 16) || 0;
    } else if (clean.startsWith('#') && clean.length === 4) {
        r = (parseInt(clean[1], 16) || 0) * 17;
        g = (parseInt(clean[2], 16) || 0) * 17;
        b = (parseInt(clean[3], 16) || 0) * 17;
    }
    const a = Math.max(0, Math.min(255, Math.round(alpha * 255)));
    _colorU32[0] = ((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff);
    return _colorF32[0];
}

export function unpackFloatToRgba(packedFloat) {
    _colorF32[0] = packedFloat;
    const u = _colorU32[0];
    return {
        r: (u >>> 24) & 0xff,
        g: (u >>> 16) & 0xff,
        b: (u >>> 8) & 0xff,
        a: u & 0xff,
    };
}

// Matriz 3x3 column-major que converte coordenadas do mundo (x, y, 1) diretamente para NDC WebGL [-1, 1]^2
export function buildViewProjMatrix3x3(viewport, out = new Float32Array(9)) {
    const w = Math.max(1, viewport.width || 1);
    const h = Math.max(1, viewport.height || 1);
    const scale = viewport.scale || 1;
    const offsetX = viewport.offsetX ?? (viewport.panX ?? w * 0.5);
    const offsetY = viewport.offsetY ?? (viewport.panY ?? h * 0.5);

    // Em Viewport do Traço:
    // screenX = offsetX + worldX * scale
    // screenY = offsetY - worldY * scale
    // NDC X = (2 * screenX / w) - 1
    // NDC Y = 1 - (2 * screenY / h)
    const sx = (2 * scale) / w;
    const sy = (2 * scale) / h;
    const tx = (2 * offsetX) / w - 1;
    const ty = 1 - (2 * offsetY) / h;

    // Column-major 3x3:
    out[0] = sx;  out[1] = 0;   out[2] = 0;
    out[3] = 0;   out[4] = sy;  out[5] = 0;
    out[6] = tx;  out[7] = ty;  out[8] = 1;
    return out;
}

// Avaliador analítico de SDF (CPU/GPU parity) para uma instância empacotada no VBO
export function evaluatePrimitiveSDF(instanceData, offsetFloats, worldPoint) {
    const ax = instanceData[offsetFloats];
    const ay = instanceData[offsetFloats + 1];
    const bx = instanceData[offsetFloats + 2];
    const by = instanceData[offsetFloats + 3];
    const b0 = instanceData[offsetFloats + 4];
    const encoded = Math.round(instanceData[offsetFloats + 7]);
    const kind = encoded & 7;

    if (kind === PRIMITIVE_KIND.SEGMENT) {
        const pax = worldPoint.x - ax;
        const pay = worldPoint.y - ay;
        const bax = bx - ax;
        const bay = by - ay;
        const lenSq = bax * bax + bay * bay;
        const len = Math.sqrt(Math.max(1e-12, lenSq));
        const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / Math.max(1e-12, lenSq)));
        const dx = pax - bax * h;
        const dy = pay - bay * h;
        return {
            distance: Math.hypot(dx, dy),
            arcCoord: h * len,
        };
    }

    // Arc / Circle
    const cx = ax;
    const cy = ay;
    const r = bx;
    const startAngle = by;
    const sweep = b0;
    const dx = worldPoint.x - cx;
    const dy = worldPoint.y - cy;
    if (kind === PRIMITIVE_KIND.CIRCLE || sweep >= Math.PI * 2 - 1e-4) {
        const ang = normalizeAngle(Math.atan2(dy, dx) - startAngle);
        return {
            distance: Math.abs(Math.hypot(dx, dy) - r),
            arcCoord: ang * r,
        };
    }
    const rel = normalizeAngle(Math.atan2(dy, dx) - startAngle);
    if (rel <= sweep) {
        return {
            distance: Math.abs(Math.hypot(dx, dy) - r),
            arcCoord: rel * r,
        };
    }
    const pStartX = cx + r * Math.cos(startAngle);
    const pStartY = cy + r * Math.sin(startAngle);
    const endAngle = startAngle + sweep;
    const pEndX = cx + r * Math.cos(endAngle);
    const pEndY = cy + r * Math.sin(endAngle);
    const dStart = Math.hypot(worldPoint.x - pStartX, worldPoint.y - pStartY);
    const dEnd = Math.hypot(worldPoint.x - pEndX, worldPoint.y - pEndY);
    return {
        distance: Math.min(dStart, dEnd),
        arcCoord: dStart <= dEnd ? 0 : sweep * r,
    };
}

// Avalia analiticamente a distância assinada ao longo de qualquer padrão do acad.lin (negativo = traço visível, positivo = vão)
export function evaluateLinetypePatternSDF(lineTypeName, arcCoord) {
    const spec = LINETYPES[lineTypeName] ?? LINETYPES.CONTINUOUS;
    const pattern = spec.pattern;
    if (!pattern || pattern.length === 0) return -Infinity;

    let period = 0;
    for (let i = 0; i < pattern.length; i += 1) {
        period += Math.abs(pattern[i]);
    }
    if (period <= 1e-9) return -Infinity;

    let s = ((arcCoord % period) + period) % period;
    let cursor = 0;
    for (let i = 0; i < pattern.length; i += 1) {
        const seg = pattern[i];
        const len = Math.abs(seg);
        const next = cursor + len;
        if (s >= cursor && s <= next) {
            if (seg >= 0) {
                // Dentro de um traço cheio (ou ponto quando seg === 0)
                return -Math.min(s - cursor, next - s);
            }
            // Dentro de um espaço vazio (gap)
            return Math.min(s - cursor, next - s);
        }
        cursor = next;
    }
    return 0;
}

export class WebGL2CadSurface {
    constructor(canvas = null, { initialCapacity = 65536 } = {}) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.vao = null;
        this.vbo = null;
        this.uViewProjLoc = null;
        this.uViewportSizeLoc = null;
        this.uWorldScaleLoc = null;

        this.capacity = Math.max(256, initialCapacity);
        this.instanceBuffer = new Float32Array(this.capacity * FLOATS_PER_INSTANCE);
        this.instanceCount = 0;
        this.entitySlots = new Map(); // entity.id -> { startSlot, count }
        this.viewProjMatrix = new Float32Array(9);
        this.lastUploadedDoc = null;
        this.lastThemeName = null;
        this.drawCallsCount = 0;
        this.bufferUploadsCount = 0;

        if (canvas && typeof canvas.getContext === 'function') {
            this._initWebGL2(canvas);
        }
    }

    isSupported() {
        return Boolean(this.gl && this.program && this.vbo);
    }

    _initWebGL2(canvas) {
        let gl = null;
        try {
            gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
        } catch {
            gl = null;
        }
        if (!gl) return false;
        this.gl = gl;

        const vs = this._compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_GLSL300);
        const fs = this._compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_GLSL300);
        if (!vs || !fs) return false;

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            return false;
        }
        this.program = prog;
        this.uViewProjLoc = gl.getUniformLocation(prog, 'uViewProj');
        this.uViewportSizeLoc = gl.getUniformLocation(prog, 'uViewportSize');
        this.uWorldScaleLoc = gl.getUniformLocation(prog, 'uWorldScale');

        this.vao = gl.createVertexArray?.() ?? null;
        if (this.vao) gl.bindVertexArray(this.vao);

        this.vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.instanceBuffer.byteLength, gl.DYNAMIC_DRAW);

        // a_geomA (location = 0)
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
        gl.vertexAttribDivisor(0, 1);

        // a_geomB (location = 1)
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 16);
        gl.vertexAttribDivisor(1, 1);

        if (this.vao) gl.bindVertexArray(null);
        return true;
    }

    _compileShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            return null;
        }
        return shader;
    }

    _ensureCapacity(neededInstances) {
        if (neededInstances <= this.capacity) return;
        let nextCap = this.capacity * 2;
        while (nextCap < neededInstances) nextCap *= 2;
        const nextBuf = new Float32Array(nextCap * FLOATS_PER_INSTANCE);
        nextBuf.set(this.instanceBuffer);
        this.instanceBuffer = nextBuf;
        this.capacity = nextCap;
        if (this.gl && this.vbo) {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.thisVboOrDefault());
            this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceBuffer.byteLength, this.gl.DYNAMIC_DRAW);
        }
    }

    thisVboOrDefault() {
        return this.vbo;
    }

    _packCurveSlot(slotIndex, curve, packedColor, widthPx, ltIdx) {
        const off = slotIndex * FLOATS_PER_INSTANCE;
        const buf = this.instanceBuffer;

        if (curve.kind === 'segment') {
            const len = Math.hypot(curve.b.x - curve.a.x, curve.b.y - curve.a.y);
            buf[off] = curve.a.x;
            buf[off + 1] = curve.a.y;
            buf[off + 2] = curve.b.x;
            buf[off + 3] = curve.b.y;
            buf[off + 4] = len;
            buf[off + 5] = packedColor;
            buf[off + 6] = widthPx;
            buf[off + 7] = PRIMITIVE_KIND.SEGMENT | (ltIdx << 3);
            return true;
        }

        if (curve.kind === 'circle') {
            buf[off] = curve.center.x;
            buf[off + 1] = curve.center.y;
            buf[off + 2] = curve.radius;
            buf[off + 3] = 0;
            buf[off + 4] = Math.PI * 2;
            buf[off + 5] = packedColor;
            buf[off + 6] = widthPx;
            buf[off + 7] = PRIMITIVE_KIND.CIRCLE | (ltIdx << 3);
            return true;
        }

        if (curve.kind === 'arc') {
            const sweep = sweepCCW(curve.start, curve.end);
            buf[off] = curve.center.x;
            buf[off + 1] = curve.center.y;
            buf[off + 2] = curve.radius;
            buf[off + 3] = curve.start;
            buf[off + 4] = sweep;
            buf[off + 5] = packedColor;
            buf[off + 6] = widthPx;
            buf[off + 7] = PRIMITIVE_KIND.ARC | (ltIdx << 3);
            return true;
        }

        return false;
    }

    // Empacota todas as primitivas estáticas do documento no VBO intercalado (1 única vez por documento)
    packDocument(doc, { theme = null, displayColorFn = null } = {}) {
        this.instanceCount = 0;
        this.entitySlots.clear();
        if (!doc || !Array.isArray(doc.entities)) return 0;

        const layersByName = new Map();
        for (let i = 0; i < (doc.layers?.length ?? 0); i += 1) {
            const l = doc.layers[i];
            layersByName.set(l.name, l);
        }

        let slot = 0;
        for (let i = 0; i < doc.entities.length; i += 1) {
            const entity = doc.entities[i];
            if (!entity) continue;
            const layer = layersByName.get(entity.layer) ?? layerOf(doc, entity.layer);
            if (layer && !layer.visible) continue;
            if (!entityOnActiveSheet(doc, entity)) continue;

            const type = entity.type;
            if (type !== 'line' && type !== 'circle' && type !== 'arc' && type !== 'polyline' && type !== 'lwpolyline') {
                continue;
            }

            const rawHex = entityColor(entity, doc);
            const hex = displayColorFn
                ? displayColorFn(rawHex)
                : (theme?.swap?.[String(rawHex).toLowerCase()] ?? rawHex);
            const packedColor = packHexColorToFloat(hex, 1);

            const lineType = entity.lineType && entity.lineType !== 'bylayer'
                ? entity.lineType
                : (layer?.lineType ?? 'CONTINUOUS');
            const ltIdx = LINETYPE_INDEX[lineType] ?? 0;
            const lineWeight = entity.lineWeight ?? layer?.lineWeight ?? 0;
            const widthPx = lineWeight > 0 ? Math.max(1, (lineWeight / 100) * 3.2) : 1.2;

            if (type === 'line') {
                this._ensureCapacity(slot + 1);
                this._packCurveSlot(slot, { kind: 'segment', a: entity.start, b: entity.end }, packedColor, widthPx, ltIdx);
                if (entity.id) this.entitySlots.set(entity.id, { startSlot: slot, count: 1 });
                slot += 1;
            } else if (type === 'circle') {
                this._ensureCapacity(slot + 1);
                this._packCurveSlot(slot, { kind: 'circle', center: entity.center, radius: entity.radius }, packedColor, widthPx, ltIdx);
                if (entity.id) this.entitySlots.set(entity.id, { startSlot: slot, count: 1 });
                slot += 1;
            } else if (type === 'arc') {
                this._ensureCapacity(slot + 1);
                this._packCurveSlot(
                    slot,
                    { kind: 'arc', center: entity.center, radius: entity.radius, start: entity.start, end: entity.end },
                    packedColor,
                    widthPx,
                    ltIdx,
                );
                if (entity.id) this.entitySlots.set(entity.id, { startSlot: slot, count: 1 });
                slot += 1;
            } else {
                const curves = entityCurves(entity);
                this._ensureCapacity(slot + curves.length);
                const startSlot = slot;
                for (let c = 0; c < curves.length; c += 1) {
                    if (this._packCurveSlot(slot, curves[c], packedColor, widthPx, ltIdx)) {
                        slot += 1;
                    }
                }
                if (entity.id && slot > startSlot) {
                    this.entitySlots.set(entity.id, { startSlot, count: slot - startSlot });
                }
            }
        }

        this.instanceCount = slot;
        this.lastUploadedDoc = doc;
        this.lastThemeName = theme?.name ?? null;

        if (this.gl && this.vbo && slot > 0) {
            const sub = this.instanceBuffer.subarray(0, slot * FLOATS_PER_INSTANCE);
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
            this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, sub);
            this.bufferUploadsCount += 1;
        }

        return slot;
    }

    // Atualização incremental de uma entidade sem reenviar o VBO inteiro
    updateEntitySlot(entity, doc, { theme = null, displayColorFn = null } = {}) {
        const entry = entity?.id ? this.entitySlots.get(entity.id) : null;
        if (!entry) return false;
        const curves = entityCurves(entity);
        if (curves.length !== entry.count) return false;

        const layer = layerOf(doc, entity.layer);
        const rawHex = entityColor(entity, doc);
        const hex = displayColorFn
            ? displayColorFn(rawHex)
            : (theme?.swap?.[String(rawHex).toLowerCase()] ?? rawHex);
        const packedColor = packHexColorToFloat(hex, 1);
        const lineType = entity.lineType && entity.lineType !== 'bylayer'
            ? entity.lineType
            : (layer?.lineType ?? 'CONTINUOUS');
        const ltIdx = LINETYPE_INDEX[lineType] ?? 0;
        const lineWeight = entity.lineWeight ?? layer?.lineWeight ?? 0;
        const widthPx = lineWeight > 0 ? Math.max(1, (lineWeight / 100) * 3.2) : 1.2;

        for (let i = 0; i < curves.length; i += 1) {
            this._packCurveSlot(entry.startSlot + i, curves[i], packedColor, widthPx, ltIdx);
        }

        if (this.gl && this.vbo) {
            const startFloat = entry.startSlot * FLOATS_PER_INSTANCE;
            const endFloat = (entry.startSlot + entry.count) * FLOATS_PER_INSTANCE;
            const sub = this.instanceBuffer.subarray(startFloat, endFloat);
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
            this.gl.bufferSubData(this.gl.ARRAY_BUFFER, startFloat * 4, sub);
            this.bufferUploadsCount += 1;
        }
        return true;
    }

    // Dispara 1 única chamada `drawArraysInstanced` atualizando apenas a matriz uniforme `u_viewProj`!
    renderFrame(doc, viewport, { theme = null, displayColorFn = null } = {}) {
        const themeName = theme?.name ?? null;
        if (doc !== this.lastUploadedDoc || themeName !== this.lastThemeName) {
            this.packDocument(doc, { theme, displayColorFn });
        }
        buildViewProjMatrix3x3(viewport, this.viewProjMatrix);

        if (!this.isSupported()) {
            return { renderedByWebGL: false, instanceCount: this.instanceCount };
        }

        const gl = this.gl;
        gl.viewport(0, 0, this.canvas?.width || viewport.width || 1, this.canvas?.height || viewport.height || 1);
        gl.useProgram(this.program);
        if (this.vao) gl.bindVertexArray(this.vao);
        gl.uniformMatrix3fv(this.uViewProjLoc, false, this.viewProjMatrix);
        gl.uniform2f(this.uViewportSizeLoc, viewport.width || 1, viewport.height || 1);
        gl.uniform1f(this.uWorldScaleLoc, viewport.scale || 1);

        if (this.instanceCount > 0) {
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.instanceCount);
            this.drawCallsCount += 1;
        }

        if (this.vao) gl.bindVertexArray(null);
        return { renderedByWebGL: true, instanceCount: this.instanceCount };
    }
}
