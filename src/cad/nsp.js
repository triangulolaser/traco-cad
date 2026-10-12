// Leitura de arquivos .nsp (Raytools), o formato do Laser 04.
//
// O .nsp é um XML (unit="4" = mm). Toda geometria de corte é `PolylineNode` com
// `pListAndBulges/endNode x y bul`, bulge na convenção do DXF (tan(θ/4), positivo
// anti-horário). Contorno fechado repete o primeiro ponto no fim; círculo vira três
// pontos (bul 1, 1, 0) e guarda o original em `originShape/CircleNode`, ignorado aqui.
//
//   GroupNode       peça: os contornos ficam em `shapes`
//   FlightCutNode   flycut: `shapes` traz os furos originais e `FlightCutPLs` o percurso
//                   real (furo partido no ponto de ligação, ligação, furo...); desenha-se
//                   o percurso e, sem ele, os furos
//   note="0"        deslocamento sem corte (ligações do flycut), marcado como `cam.link`
//   tlayer          camada de processo da Raytools; vira o layer `T<n>` e `cam.process`
//
// A ordem de corte é a ordem dos nós (premissa ainda não conferida na máquina) e a entrada
// fica no primeiro vértice.
//
// Formato levantado em 03/10/2026 com as amostras do Laser 04 e os nests do ProNest.

import { parseXml } from './lxds.js';

const SKIPPED = new Set(['originShape', 'offsetme', 'leadIn', 'leadOut', 'weiLianPoints', 'protectedPoints']);

export function looksLikeNsp(text) {
    const head = String(text).slice(0, 512).replace(/^﻿/, '');
    return /^\s*(<\?xml[^>]*\?>\s*)?<root\b[^>]*\bV2="/.test(head);
}

function property(node) {
    return node.children.find((c) => c.tag === 'CommonProperty')?.attrs || {};
}

function polylineEntity(node) {
    const props = property(node);
    const list = node.children.find((c) => c.tag === 'pListAndBulges');
    const vertices = (list?.children || [])
        .filter((c) => c.tag === 'endNode')
        .map((c) => ({ x: Number(c.attrs.x), y: Number(c.attrs.y), bulge: Number(c.attrs.bul) || 0 }))
        .filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
    if (vertices.length < 2) return null;
    const first = vertices[0];
    const last = vertices[vertices.length - 1];
    const closed = vertices.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-6;
    if (closed) vertices.pop();
    const process = Number(props.tlayer) || 0;
    return { type: 'polyline', layer: `T${process}`, closed, vertices, cam: { process, leadFraction: 0, link: props.note === '0' } };
}

function collect(node, out) {
    for (const child of node.children) {
        if (SKIPPED.has(child.tag)) continue;
        if (child.tag === 'PolylineNode') {
            const entity = polylineEntity(child);
            if (entity) out.push(entity);
            continue;
        }
        if (child.tag === 'FlightCutNode') {
            const path = child.children.find((c) => c.tag === 'FlightCutPLs');
            const shapes = child.children.find((c) => c.tag === 'shapes');
            const before = out.length;
            if (path) collect(path, out);
            if (out.length === before && shapes) collect(shapes, out);
            continue;
        }
        collect(child, out);
    }
}

export function nspToEntities(text, { name = 'desenho.nsp' } = {}) {
    const xml = String(text).replace(/^﻿/, '');
    if (!looksLikeNsp(xml)) throw new Error('Arquivo .nsp sem a raiz <root V2=...> da Raytools.');
    const root = parseXml(xml);
    const entities = [];
    collect(root, entities);
    if (root.attrs.unit && root.attrs.unit !== '4') {
        throw new Error(`Unidade ${root.attrs.unit} do .nsp não suportada; só milímetros (unit="4").`);
    }
    const cuts = entities.filter((e) => !e.cam.link);
    return {
        entities,
        layers: [...new Set(cuts.map((e) => e.layer))],
        stats: {
            polylines: cuts.length,
            closed: cuts.filter((e) => e.closed).length,
            arcs: cuts.reduce((n, e) => n + e.vertices.filter((v) => Math.abs(v.bulge) > 1e-12).length, 0),
            links: entities.length - cuts.length,
        },
        application: root.attrs.V2 ? `Raytools ${root.attrs.V2}` : 'Raytools',
        name: name.replace(/\.nsp$/i, ''),
        sourceFormat: 'nsp',
    };
}
