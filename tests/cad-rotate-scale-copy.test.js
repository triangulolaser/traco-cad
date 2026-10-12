import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, resolveCommand } from '../src/cad/commands.js';
import { distance } from '../src/cad/geometry.js';

const close = (a, b, tol = 1e-5) => Math.abs(a - b) <= tol;

test('resolveCommand: aliases de ROTATE, SCALE e COPY', () => {
    for (const name of ['ROTATE', 'RO', 'ROTACIONAR', 'ro', 'rotacionar']) {
        assert.equal(resolveCommand(name)?.name, 'ROTATE');
    }
    for (const name of ['SCALE', 'SC', 'ESCALAR', 'sc', 'escalar']) {
        assert.equal(resolveCommand(name)?.name, 'SCALE');
    }
    for (const name of ['COPY', 'CO', 'CP', 'COPIAR', 'co', 'cp', 'copiar']) {
        assert.equal(resolveCommand(name)?.name, 'COPY');
    }
});

test('ROTATE: rotação direta por ângulo numérico atualiza entidade original', async () => {
    const line = { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, layer: '0' };
    let committedDoc = null;
    const mockEditor = {
        doc: { entities: [line] },
        getSelection: async () => ['l1'],
        entitiesById: () => [line],
        getPoint: async (prompt) => {
            if (prompt.includes('Ponto base')) return { point: { x: 0, y: 0 } };
            if (prompt.includes('Ângulo de rotação')) return { number: 90 };
            return null;
        },
        commit: (label, newDoc) => {
            committedDoc = newDoc;
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.ROTATE.run(mockEditor);
    assert.ok(committedDoc);
    assert.equal(committedDoc.entities.length, 1);
    const rotated = committedDoc.entities[0];
    assert.equal(rotated.id, 'l1');
    assert.ok(close(rotated.start.x, 0) && close(rotated.start.y, 0));
    assert.ok(close(rotated.end.x, 0) && close(rotated.end.y, 10));
});

test('ROTATE: opção Copiar (c) preserva entidade original e adiciona nova rotacionada', async () => {
    const line = { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, layer: '0' };
    let committedDoc = null;
    let rotatePromptCount = 0;
    const mockEditor = {
        doc: { entities: [line] },
        getSelection: async () => ['l1'],
        entitiesById: () => [line],
        getPoint: async (prompt) => {
            if (prompt.includes('Ponto base')) return { point: { x: 0, y: 0 } };
            if (prompt.includes('Ângulo de rotação')) {
                rotatePromptCount++;
                if (rotatePromptCount === 1) return { keyword: 'c' };
                return { number: 90 };
            }
            return null;
        },
        commit: (label, newDoc) => {
            committedDoc = newDoc;
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.ROTATE.run(mockEditor);
    assert.ok(committedDoc);
    assert.equal(committedDoc.entities.length, 2);
    // Original intacto
    const orig = committedDoc.entities.find((e) => e.id === 'l1');
    assert.ok(orig);
    assert.ok(close(orig.end.x, 10) && close(orig.end.y, 0));
    // Cópia rotacionada
    const copy = committedDoc.entities.find((e) => e.id !== 'l1');
    assert.ok(copy);
    assert.ok(close(copy.start.x, 0) && close(copy.start.y, 0));
    assert.ok(close(copy.end.x, 0) && close(copy.end.y, 10));
});

test('ROTATE: opção Referência (r) com ângulos numéricos (delta = novo - ref)', async () => {
    // Linha a 30° graus com comprimento 10: end = (10*cos(30°), 10*sin(30°)) = (8.66025, 5)
    const line = { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 8.660254, y: 5 }, layer: '0' };
    let committedDoc = null;
    const mockEditor = {
        doc: { entities: [line] },
        getSelection: async () => ['l1'],
        entitiesById: () => [line],
        getPoint: async (prompt) => {
            if (prompt.includes('Ponto base')) return { point: { x: 0, y: 0 } };
            if (prompt.includes('Ângulo de rotação')) return { keyword: 'r' };
            if (prompt.includes('Ângulo de referência')) return { number: 30 };
            if (prompt.includes('Novo ângulo')) return { number: 90 };
            return null;
        },
        commit: (label, newDoc) => {
            committedDoc = newDoc;
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.ROTATE.run(mockEditor);
    assert.ok(committedDoc);
    const rotated = committedDoc.entities[0];
    // Ângulo delta = 90 - 30 = 60°. Nova direção deve ser 30° + 60° = 90° (vertical!)
    assert.ok(close(rotated.start.x, 0) && close(rotated.start.y, 0));
    assert.ok(close(rotated.end.x, 0) && close(rotated.end.y, 10));
});

test('ROTATE: opção Referência (r) com 2 pontos de referência e opção Pontos (p) para novo ângulo', async () => {
    const line = { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, layer: '0' };
    let committedDoc = null;
    const mockEditor = {
        doc: { entities: [line] },
        getSelection: async () => ['l1'],
        entitiesById: () => [line],
        getPoint: async (prompt) => {
            if (prompt.includes('Ponto base')) return { point: { x: 0, y: 0 } };
            if (prompt.includes('Ângulo de rotação')) return { keyword: 'r' };
            if (prompt.includes('Ângulo de referência')) return { point: { x: 0, y: 0 } };
            if (prompt.includes('Segundo ponto do ângulo de referência')) return { point: { x: 10, y: 0 } }; // 0 rad
            if (prompt.includes('Novo ângulo')) return { keyword: 'p' };
            if (prompt.includes('Primeiro ponto do novo ângulo')) return { point: { x: 0, y: 0 } };
            if (prompt.includes('Segundo ponto do novo ângulo')) return { point: { x: -10, y: 0 } }; // 180° (PI rad)
            return null;
        },
        commit: (label, newDoc) => {
            committedDoc = newDoc;
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.ROTATE.run(mockEditor);
    assert.ok(committedDoc);
    const rotated = committedDoc.entities[0];
    // Rotacionado por 180 graus: ponta final deve estar em (-10, 0)
    assert.ok(close(rotated.start.x, 0) && close(rotated.start.y, 0));
    assert.ok(close(rotated.end.x, -10) && close(rotated.end.y, 0));
});

test('SCALE: escala direta por fator numérico atualiza entidade original', async () => {
    const line = { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, layer: '0' };
    let committedDoc = null;
    const mockEditor = {
        doc: { entities: [line] },
        getSelection: async () => ['l1'],
        entitiesById: () => [line],
        getPoint: async (prompt) => {
            if (prompt.includes('Ponto base')) return { point: { x: 0, y: 0 } };
            if (prompt.includes('Fator de escala')) return { number: 2.5 };
            return null;
        },
        commit: (label, newDoc) => {
            committedDoc = newDoc;
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.SCALE.run(mockEditor);
    assert.ok(committedDoc);
    assert.equal(committedDoc.entities.length, 1);
    const scaled = committedDoc.entities[0];
    assert.ok(close(scaled.start.x, 0) && close(scaled.start.y, 0));
    assert.ok(close(scaled.end.x, 25) && close(scaled.end.y, 0));
});

test('SCALE: opção Copiar (c) preserva original e adiciona cópia escalada', async () => {
    const line = { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, layer: '0' };
    let committedDoc = null;
    let scalePromptCount = 0;
    const mockEditor = {
        doc: { entities: [line] },
        getSelection: async () => ['l1'],
        entitiesById: () => [line],
        getPoint: async (prompt) => {
            if (prompt.includes('Ponto base')) return { point: { x: 0, y: 0 } };
            if (prompt.includes('Fator de escala')) {
                scalePromptCount++;
                if (scalePromptCount === 1) return { keyword: 'c' };
                return { number: 3 };
            }
            return null;
        },
        commit: (label, newDoc) => {
            committedDoc = newDoc;
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.SCALE.run(mockEditor);
    assert.ok(committedDoc);
    assert.equal(committedDoc.entities.length, 2);
    const orig = committedDoc.entities.find((e) => e.id === 'l1');
    assert.ok(close(orig.end.x, 10));
    const copy = committedDoc.entities.find((e) => e.id !== 'l1');
    assert.ok(close(copy.end.x, 30));
});

test('SCALE: opção Referência (r) calcula fator = novoComprimento / comprimentoRef', async () => {
    const line = { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, layer: '0' };
    let committedDoc = null;
    const mockEditor = {
        doc: { entities: [line] },
        getSelection: async () => ['l1'],
        entitiesById: () => [line],
        getPoint: async (prompt) => {
            if (prompt.includes('Ponto base')) return { point: { x: 0, y: 0 } };
            if (prompt.includes('Fator de escala')) return { keyword: 'r' };
            if (prompt.includes('Comprimento de referência')) return { number: 10 };
            if (prompt.includes('Novo comprimento')) return { number: 35 };
            return null;
        },
        commit: (label, newDoc) => {
            committedDoc = newDoc;
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.SCALE.run(mockEditor);
    assert.ok(committedDoc);
    const scaled = committedDoc.entities[0];
    // Fator = 35 / 10 = 3.5. Comprimento final deve ser 35.
    assert.ok(close(scaled.end.x, 35) && close(scaled.end.y, 0));
});

test('SCALE: opção Referência (r) com 2 pontos e opção Pontos (p)', async () => {
    const line = { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 20, y: 0 }, layer: '0' };
    let committedDoc = null;
    const mockEditor = {
        doc: { entities: [line] },
        getSelection: async () => ['l1'],
        entitiesById: () => [line],
        getPoint: async (prompt) => {
            if (prompt.includes('Ponto base')) return { point: { x: 0, y: 0 } };
            if (prompt.includes('Fator de escala')) return { keyword: 'r' };
            if (prompt.includes('Comprimento de referência')) return { point: { x: 0, y: 0 } };
            if (prompt.includes('Segundo ponto do comprimento de referência')) return { point: { x: 20, y: 0 } }; // refLength = 20
            if (prompt.includes('Novo comprimento')) return { keyword: 'p' };
            if (prompt.includes('Primeiro ponto do novo comprimento')) return { point: { x: 0, y: 0 } };
            if (prompt.includes('Segundo ponto do novo comprimento')) return { point: { x: 5, y: 0 } }; // newLength = 5
            return null;
        },
        commit: (label, newDoc) => {
            committedDoc = newDoc;
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.SCALE.run(mockEditor);
    assert.ok(committedDoc);
    const scaled = committedDoc.entities[0];
    // Fator = 5 / 20 = 0.25. Comprimento final deve ser 5.
    assert.ok(close(scaled.end.x, 5) && close(scaled.end.y, 0));
});

test('COPY: cópia com múltiplos pontos até Enter', async () => {
    const line = { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, layer: '0' };
    const commits = [];
    let step = 0;
    const mockEditor = {
        doc: { entities: [line] },
        getSelection: async () => ['l1'],
        entitiesById: () => [line],
        getPoint: async (prompt) => {
            if (prompt.includes('Ponto base')) return { point: { x: 0, y: 0 } };
            if (prompt.includes('Segundo ponto')) {
                step++;
                if (step === 1) return { point: { x: 0, y: 10 } };
                if (step === 2) return { point: { x: 0, y: 20 } };
                return { enter: true };
            }
            return null;
        },
        commit: (label, newDoc) => {
            commits.push(newDoc);
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.COPY.run(mockEditor);
    assert.equal(commits.length, 2);
    assert.equal(mockEditor.doc.entities.length, 3);
    const copy1 = mockEditor.doc.entities[1];
    const copy2 = mockEditor.doc.entities[2];
    assert.ok(close(copy1.start.y, 10) && close(copy1.end.y, 10));
    assert.ok(close(copy2.start.y, 20) && close(copy2.end.y, 20));
});

test('COPY: opção mÚltiplo (m) no ponto base', async () => {
    const line = { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, layer: '0' };
    let basePromptCount = 0;
    const mockEditor = {
        doc: { entities: [line] },
        getSelection: async () => ['l1'],
        entitiesById: () => [line],
        getPoint: async (prompt) => {
            if (prompt.includes('Ponto base')) {
                basePromptCount++;
                if (basePromptCount === 1) return { keyword: 'm' };
                return { point: { x: 0, y: 0 } };
            }
            if (prompt.includes('Segundo ponto')) return { point: { x: 50, y: 0 } };
            return null;
        },
        commit: (label, newDoc) => {
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    // Quebra após o primeiro commit simulando término pelo usuário
    const origCommit = mockEditor.commit;
    let didCommit = false;
    mockEditor.commit = (label, doc) => {
        didCommit = true;
        origCommit(label, doc);
    };
    const origGetPoint = mockEditor.getPoint;
    mockEditor.getPoint = async (prompt, opts) => {
        if (didCommit) return { enter: true };
        return origGetPoint(prompt, opts);
    };

    await COMMANDS.COPY.run(mockEditor);
    assert.equal(mockEditor.doc.entities.length, 2);
    assert.ok(close(mockEditor.doc.entities[1].start.x, 50));
});

test('COPY: opção Array (a) com passo regular gera N-1 cópias', async () => {
    const line = { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, layer: '0' };
    let secondPromptCount = 0;
    const mockEditor = {
        doc: { entities: [line] },
        getSelection: async () => ['l1'],
        entitiesById: () => [line],
        getNumber: async (prompt) => {
            if (prompt.includes('Número de itens')) return 4; // 1 original + 3 cópias
            return 2;
        },
        getPoint: async (prompt) => {
            if (prompt.includes('Ponto base')) return { point: { x: 0, y: 0 } };
            if (prompt.includes('Segundo ponto ou [Array]')) {
                secondPromptCount++;
                if (secondPromptCount === 1) return { keyword: 'a' };
                return { enter: true };
            }
            if (prompt.includes('Segundo ponto ou [Ajustar]')) {
                return { point: { x: 20, y: 0 } }; // delta por item = (20, 0)
            }
            return null;
        },
        commit: (label, newDoc) => {
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.COPY.run(mockEditor);
    // Deve ter 4 entidades no total (1 original + 3 cópias)
    assert.equal(mockEditor.doc.entities.length, 4);
    assert.ok(close(mockEditor.doc.entities[0].start.x, 0));
    assert.ok(close(mockEditor.doc.entities[1].start.x, 20));
    assert.ok(close(mockEditor.doc.entities[2].start.x, 40));
    assert.ok(close(mockEditor.doc.entities[3].start.x, 60));
});

test('COPY: opção Array (a) com opção Ajustar (f) distribui itens até a extensão total', async () => {
    const line = { id: 'l1', type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, layer: '0' };
    let secondPromptCount = 0;
    const mockEditor = {
        doc: { entities: [line] },
        getSelection: async () => ['l1'],
        entitiesById: () => [line],
        getNumber: async (prompt) => {
            if (prompt.includes('Número de itens')) return 5; // 1 original + 4 cópias
            return 2;
        },
        getPoint: async (prompt) => {
            if (prompt.includes('Ponto base')) return { point: { x: 0, y: 0 } };
            if (prompt.includes('Segundo ponto ou [Array]')) {
                secondPromptCount++;
                if (secondPromptCount === 1) return { keyword: 'a' };
                return { enter: true };
            }
            if (prompt.includes('Segundo ponto ou [Ajustar]')) {
                return { keyword: 'f' };
            }
            if (prompt.includes('Segundo ponto (Ajustar)')) {
                return { point: { x: 100, y: 0 } }; // Extensão total = 100; passo = 100 / (5 - 1) = 25
            }
            return null;
        },
        commit: (label, newDoc) => {
            mockEditor.doc = newDoc;
        },
        log: () => {},
    };

    await COMMANDS.COPY.run(mockEditor);
    assert.equal(mockEditor.doc.entities.length, 5);
    assert.ok(close(mockEditor.doc.entities[0].start.x, 0));
    assert.ok(close(mockEditor.doc.entities[1].start.x, 25));
    assert.ok(close(mockEditor.doc.entities[2].start.x, 50));
    assert.ok(close(mockEditor.doc.entities[3].start.x, 75));
    assert.ok(close(mockEditor.doc.entities[4].start.x, 100));
});
