import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, resolveCommand } from '../src/cad/commands.js';
import { distance } from '../src/cad/geometry.js';

const close = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol;

test('resolveCommand: aliases de DIMBASELINE e DIMCONTINUE', () => {
    for (const name of ['DIMBASELINE', 'DBA', 'DIMBASE', 'LINHABASE', 'dba', 'dimbase', 'linhabase']) {
        assert.equal(resolveCommand(name)?.name, 'DIMBASELINE');
    }
    for (const name of ['DIMCONTINUE', 'DCO', 'DIMCONT', 'CONTINUAR', 'dco', 'dimcont', 'continuar']) {
        assert.equal(resolveCommand(name)?.name, 'DIMCONTINUE');
    }
});

test('DIMCONTINUE: encadeia cota contínua a partir da última cota linear do documento', async () => {
    const baseDim = {
        id: 'dim1',
        type: 'dimension',
        kind: 'horizontal',
        p1: { x: 0, y: 0 },
        p2: { x: 50, y: 0 },
        linePoint: { x: 25, y: 20 },
        layer: 'dimensions',
    };

    const commits = [];
    const mockEditor = {
        doc: { layers: [{ name: 'dimensions', color: 1 }], entities: [baseDim], dimStyle: { textHeight: 2.5, scale: 1, precision: 2 } },
        memory: {},
        getPoint: async (prompt) => {
            if (prompt.includes('Segundo ponto da cota contínua')) {
                if (commits.length === 0) return { point: { x: 120, y: 0 } };
                return { enter: true };
            }
            return null;
        },
        commit: (label, newDoc) => {
            commits.push({ label, entities: newDoc.entities });
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.DIMCONTINUE.run(mockEditor);
    assert.equal(commits.length, 1);
    assert.equal(mockEditor.doc.entities.length, 2);

    const contDim = mockEditor.doc.entities[1];
    assert.equal(contDim.type, 'dimension');
    assert.equal(contDim.kind, 'horizontal');
    // Início da nova cota é o final da cota base (50, 0)
    assert.ok(close(contDim.p1.x, 50) && close(contDim.p1.y, 0));
    // Final da nova cota é o ponto fornecido (120, 0)
    assert.ok(close(contDim.p2.x, 120) && close(contDim.p2.y, 0));
    // Linha de cota é na mesma altura Y da cota anterior (20)
    assert.ok(close(contDim.linePoint.y, 20));
});

test('DIMCONTINUE: encadeia múltiplos pontos sucessivos no loop', async () => {
    const baseDim = {
        id: 'dim1',
        type: 'dimension',
        kind: 'horizontal',
        p1: { x: 0, y: 0 },
        p2: { x: 40, y: 0 },
        linePoint: { x: 20, y: 15 },
        layer: 'dimensions',
    };

    let step = 0;
    const mockEditor = {
        doc: { layers: [{ name: 'dimensions', color: 1 }], entities: [baseDim], dimStyle: { textHeight: 2.5, scale: 1, precision: 2 } },
        memory: {},
        getPoint: async (prompt) => {
            if (prompt.includes('Segundo ponto da cota contínua')) {
                step++;
                if (step === 1) return { point: { x: 90, y: 0 } };
                if (step === 2) return { point: { x: 160, y: 0 } };
                return { enter: true };
            }
            return null;
        },
        commit: (label, newDoc) => {
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.DIMCONTINUE.run(mockEditor);
    assert.equal(mockEditor.doc.entities.length, 3);

    const d2 = mockEditor.doc.entities[1];
    assert.ok(close(d2.p1.x, 40) && close(d2.p2.x, 90));
    assert.ok(close(d2.linePoint.y, 15));

    const d3 = mockEditor.doc.entities[2];
    assert.ok(close(d3.p1.x, 90) && close(d3.p2.x, 160));
    assert.ok(close(d3.linePoint.y, 15));
});

test('DIMCONTINUE: preserva kind aligned e linha de cota em cotas inclinadas', async () => {
    const baseDim = {
        id: 'dim_aligned',
        type: 'dimension',
        kind: 'aligned',
        p1: { x: 0, y: 0 },
        p2: { x: 30, y: 40 }, // direção (0.6, 0.8)
        linePoint: { x: -8, y: 46 }, // offset perpendicular
        layer: 'dimensions',
    };

    let step = 0;
    const mockEditor = {
        doc: { layers: [{ name: 'dimensions', color: 1 }], entities: [baseDim], dimStyle: { textHeight: 2.5, scale: 1, precision: 2 } },
        memory: {},
        getPoint: async (prompt) => {
            if (prompt.includes('Segundo ponto da cota contínua')) {
                step++;
                if (step === 1) return { point: { x: 60, y: 80 } };
                return { enter: true };
            }
            return null;
        },
        commit: (label, newDoc) => {
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.DIMCONTINUE.run(mockEditor);
    assert.equal(mockEditor.doc.entities.length, 2);
    const cont = mockEditor.doc.entities[1];
    assert.equal(cont.kind, 'aligned');
    assert.ok(close(cont.p1.x, 30) && close(cont.p1.y, 40));
    assert.ok(close(cont.p2.x, 60) && close(cont.p2.y, 80));
});

test('DIMCONTINUE: solicita seleção de cota quando não há cota prévia no documento', async () => {
    const existingDim = {
        id: 'dim_custom',
        type: 'dimension',
        kind: 'vertical',
        p1: { x: 10, y: 0 },
        p2: { x: 10, y: 50 },
        linePoint: { x: -5, y: 25 },
        layer: 'dimensions',
    };

    let promptCount = 0;
    const mockEditor = {
        doc: { layers: [{ name: 'dimensions', color: 1 }], entities: [existingDim], dimStyle: { textHeight: 2.5, scale: 1, precision: 2 } },
        memory: {},
        getEntity: async (prompt) => {
            if (prompt.includes('Selecione cota')) return { entity: existingDim, point: { x: 10, y: 45 } };
            return null;
        },
        getPoint: async (prompt) => {
            if (prompt.includes('Segundo ponto da cota contínua')) {
                promptCount++;
                if (promptCount === 1) return { keyword: 's' }; // Simula usuário escolhendo selecionar outra
                if (promptCount === 2) return { point: { x: 10, y: 110 } };
                return { enter: true };
            }
            return null;
        },
        commit: (label, newDoc) => {
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.DIMCONTINUE.run(mockEditor);
    assert.equal(mockEditor.doc.entities.length, 2);
    const cont = mockEditor.doc.entities[1];
    assert.equal(cont.kind, 'vertical');
    assert.ok(close(cont.p1.y, 50));
    assert.ok(close(cont.p2.y, 110));
    assert.ok(close(cont.linePoint.x, -5));
});

test('DIMBASELINE: acumula cotas a partir da mesma origem com espaçamento de linha base', async () => {
    const baseDim = {
        id: 'dim1',
        type: 'dimension',
        kind: 'horizontal',
        p1: { x: 0, y: 0 },
        p2: { x: 50, y: 0 },
        linePoint: { x: 25, y: 20 }, // Acima da peça (y = 20 > 0)
        layer: 'dimensions',
    };

    let step = 0;
    const mockEditor = {
        doc: { layers: [{ name: 'dimensions', color: 1 }], entities: [baseDim], dimStyle: { textHeight: 2.5, scale: 1, precision: 2, dimDli: 10 } },
        memory: {},
        getPoint: async (prompt) => {
            if (prompt.includes('Segundo ponto da cota por linha base')) {
                step++;
                if (step === 1) return { point: { x: 100, y: 0 } };
                if (step === 2) return { point: { x: 160, y: 0 } };
                return { enter: true };
            }
            return null;
        },
        commit: (label, newDoc) => {
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.DIMBASELINE.run(mockEditor);
    assert.equal(mockEditor.doc.entities.length, 3);

    // Cota 1 da linha de base: de (0,0) a (100,0) na altura 20 + 10 = 30
    const d1 = mockEditor.doc.entities[1];
    assert.equal(d1.type, 'dimension');
    assert.equal(d1.kind, 'horizontal');
    assert.ok(close(d1.p1.x, 0) && close(d1.p1.y, 0));
    assert.ok(close(d1.p2.x, 100) && close(d1.p2.y, 0));
    assert.ok(close(d1.linePoint.y, 30));

    // Cota 2 da linha de base: de (0,0) a (160,0) na altura 30 + 10 = 40
    const d2 = mockEditor.doc.entities[2];
    assert.ok(close(d2.p1.x, 0) && close(d2.p1.y, 0));
    assert.ok(close(d2.p2.x, 160) && close(d2.p2.y, 0));
    assert.ok(close(d2.linePoint.y, 40));
});

test('DIMBASELINE: afasta linha de cota para baixo quando a cota base estiver abaixo da peça', async () => {
    const baseDim = {
        id: 'dim_bottom',
        type: 'dimension',
        kind: 'horizontal',
        p1: { x: 0, y: 0 },
        p2: { x: 50, y: 0 },
        linePoint: { x: 25, y: -20 }, // Abaixo da peça (y = -20 < 0)
        layer: 'dimensions',
    };

    let step = 0;
    const mockEditor = {
        doc: { layers: [{ name: 'dimensions', color: 1 }], entities: [baseDim], dimStyle: { textHeight: 2.5, scale: 1, precision: 2, dimDli: 12 } },
        memory: {},
        getPoint: async (prompt) => {
            if (prompt.includes('Segundo ponto da cota por linha base')) {
                step++;
                if (step === 1) return { point: { x: 80, y: 0 } };
                return { enter: true };
            }
            return null;
        },
        commit: (label, newDoc) => {
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.DIMBASELINE.run(mockEditor);
    assert.equal(mockEditor.doc.entities.length, 2);

    const d = mockEditor.doc.entities[1];
    assert.ok(close(d.p1.x, 0) && close(d.p1.y, 0));
    assert.ok(close(d.p2.x, 80) && close(d.p2.y, 0));
    // Abaixo da peça: -20 - 12 = -32
    assert.ok(close(d.linePoint.y, -32));
});

test('DIMBASELINE: seleção explícita por clique inverte P1/P2 se clicado mais próximo da segunda extensão', async () => {
    const baseDim = {
        id: 'dim1',
        type: 'dimension',
        kind: 'horizontal',
        p1: { x: 0, y: 0 },
        p2: { x: 100, y: 0 },
        linePoint: { x: 50, y: 25 },
        layer: 'dimensions',
    };

    let promptCount = 0;
    const mockEditor = {
        doc: { layers: [{ name: 'dimensions', color: 1 }], entities: [baseDim], dimStyle: { textHeight: 2.5, scale: 1, precision: 2, dimDli: 10 } },
        memory: {},
        getEntity: async () => ({
            entity: baseDim,
            point: { x: 95, y: 0 }, // Clicado mais próximo de P2 (100, 0)
        }),
        getPoint: async (prompt) => {
            if (prompt.includes('Segundo ponto da cota por linha base')) {
                promptCount++;
                if (promptCount === 1) return { keyword: 's' };
                if (promptCount === 2) return { point: { x: 180, y: 0 } };
                return { enter: true };
            }
            return null;
        },
        commit: (label, newDoc) => {
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.DIMBASELINE.run(mockEditor);
    assert.equal(mockEditor.doc.entities.length, 2);
    const d = mockEditor.doc.entities[1];
    // Inverteu a origem para P2 (100, 0)
    assert.ok(close(d.p1.x, 100) && close(d.p1.y, 0));
    assert.ok(close(d.p2.x, 180) && close(d.p2.y, 0));
    assert.ok(close(d.linePoint.y, 35));
});
