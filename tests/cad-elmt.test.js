import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
    looksLikeElmt,
    elmtToDocument,
    documentToElmt,
    generateUuid,
    ELMT_DEFAULT_LAYER,
    ELMT_TERMINAL_LAYER,
} from '../src/cad/elmt.js';
import { getEntityGrips, applyGripMove } from '../src/cad/grips.js';
import { entityProvider } from '../src/cad/geometry.js';
import '../src/cad/extra-entities.js';

test('looksLikeElmt detecta formato QElectroTech corretamente', () => {
    assert.equal(looksLikeElmt('<definition width="100" height="100" type="element"><description/></definition>'), true);
    assert.equal(looksLikeElmt('<?xml version="1.0"?>\n<definition height="50" width="50" type="element"/>'), true);

    const buf = new TextEncoder().encode('<definition type="element" width="80" height="40"/>');
    assert.equal(looksLikeElmt(buf), true);
    assert.equal(looksLikeElmt(buf.buffer), true);

    assert.equal(looksLikeElmt('0\nSECTION\n2\nHEADER\n0\nENDSEC'), false);
    assert.equal(looksLikeElmt('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), false);
    assert.equal(looksLikeElmt('{"name": "test"}'), false);
    assert.equal(looksLikeElmt(''), false);
    assert.equal(looksLikeElmt(null), false);
    assert.equal(looksLikeElmt(undefined), false);
});

test('generateUuid gera formato UUID válido delimitado por chaves', () => {
    const uuid = generateUuid();
    assert.match(uuid, /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i);
});

test('elmtToDocument importa elementos básicos e inverte coordenada Y com precisão', () => {
    const sampleXml = `<?xml version="1.0" encoding="utf-8"?>
<definition height="80" hotspot_x="40" hotspot_y="40" link_type="simple" type="element" version="0.80" width="80">
    <uuid uuid="{11111111-2222-3333-4444-555555555555}"/>
    <names>
        <name lang="pt">Relé Auxiliar</name>
        <name lang="en">Auxiliary Relay</name>
    </names>
    <informations>Componente de Teste</informations>
    <description>
        <line x1="-30" y1="-20" x2="30" y2="-20" style="color:black"/>
        <circle diameter="10" x="-5" y="-5"/>
        <rect width="60" height="40" x="-30" y="-20"/>
        <text text="K1" x="-10" y="5" size="6" rotation="0"/>
        <terminal x="0" y="-20" orientation="n" name="A1" type="Generic" uuid="{aaaa-1111}"/>
        <terminal x="0" y="20" orientation="s" name="A2" type="Generic" uuid="{bbbb-2222}"/>
    </description>
</definition>`;

    const doc = elmtToDocument(sampleXml, { name: 'rele.elmt' });

    assert.equal(doc.sourceFormat, 'elmt');
    assert.equal(doc.name, 'rele.elmt');
    assert.equal(doc.elmtMetadata.width, 80);
    assert.equal(doc.elmtMetadata.height, 80);
    assert.equal(doc.elmtMetadata.hotspot_x, 40);
    assert.equal(doc.elmtMetadata.hotspot_y, 40);
    assert.equal(doc.elmtMetadata.names.pt, 'Relé Auxiliar');
    assert.equal(doc.elmtMetadata.names.en, 'Auxiliary Relay');
    assert.equal(doc.elmtMetadata.informations, 'Componente de Teste');

    // Layers
    const layerNames = doc.layers.map((l) => l.name);
    assert.ok(layerNames.includes(ELMT_DEFAULT_LAYER));
    assert.ok(layerNames.includes(ELMT_TERMINAL_LAYER));

    // Entidades
    const lines = doc.entities.filter((e) => e.type === 'line');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].start.x, -30);
    assert.equal(lines[0].start.y, 20); // -(-20) = 20
    assert.equal(lines[0].end.x, 30);
    assert.equal(lines[0].end.y, 20);

    const circles = doc.entities.filter((e) => e.type === 'circle');
    assert.equal(circles.length, 1);
    assert.equal(circles[0].radius, 5); // diameter 10 / 2
    assert.equal(circles[0].center.x, 0); // -5 + 5
    assert.equal(circles[0].center.y, 0); // -(-5 + 5)

    const rects = doc.entities.filter((e) => e.type === 'polyline');
    assert.equal(rects.length, 1);
    assert.equal(rects[0].closed, true);
    assert.equal(rects[0].vertices.length, 4);

    const texts = doc.entities.filter((e) => e.type === 'text');
    assert.equal(texts.length, 1);
    assert.equal(texts[0].text, 'K1');
    assert.equal(texts[0].position.x, -10);
    assert.equal(texts[0].position.y, -5); // -5

    const terminals = doc.entities.filter((e) => e.type === 'terminal');
    assert.equal(terminals.length, 2);
    assert.equal(terminals[0].name, 'A1');
    assert.equal(terminals[0].orientation, 'n');
    assert.equal(terminals[0].position.x, 0);
    assert.equal(terminals[0].position.y, 20); // -(-20)
    assert.equal(terminals[0].uuid, '{aaaa-1111}');

    assert.equal(terminals[1].name, 'A2');
    assert.equal(terminals[1].orientation, 's');
    assert.equal(terminals[1].position.x, 0);
    assert.equal(terminals[1].position.y, -20); // -(20)
});

test('elmtToDocument importa arquivo real de conector Deutsch DT04-12PA', () => {
    const filePath = '/Users/usuario/Documents/exemplo.elmt';
    if (!existsSync(filePath)) {
        return; // Pula se ambiente sem acesso ao iCloud Drive
    }

    const xml = readFileSync(filePath, 'utf8');
    assert.ok(looksLikeElmt(xml));

    const doc = elmtToDocument(xml, { name: 'c-dt04-12pa-l012-vista-frontal.elmt' });

    assert.equal(doc.sourceFormat, 'elmt');
    assert.equal(doc.elmtMetadata.uuid, '{19eb44af-8ddd-4bf2-bb4d-23a376c8b823}');
    assert.equal(doc.elmtMetadata.names.pt, 'C-DT04-12PA-L012 — vista frontal');

    // Valida terminais: conector 12 vias precisa ter exatamente 12 terminais
    const terminals = doc.entities.filter((e) => e.type === 'terminal');
    assert.equal(terminals.length, 12, 'Conector DT04-12 vias deve ter exatamente 12 terminais');

    // Todos os terminais devem ter orientações válidas (n ou s no conector frontal)
    terminals.forEach((t) => {
        assert.ok(['n', 's'].includes(t.orientation));
        assert.equal(typeof t.position.x, 'number');
        assert.equal(typeof t.position.y, 'number');
        assert.ok(t.uuid.startsWith('{'));
    });

    // Deve conter primitivas gráficas do invólucro do conector
    const polylines = doc.entities.filter((e) => e.type === 'polyline');
    const circles = doc.entities.filter((e) => e.type === 'circle');
    const lines = doc.entities.filter((e) => e.type === 'line');
    const texts = doc.entities.filter((e) => e.type === 'text');

    assert.ok(polylines.length > 0, 'Deve conter contornos poligonais');
    assert.ok(circles.length >= 4, 'Deve conter as 4 furações dos pinos de fixação');
    assert.ok(lines.length > 0, 'Deve conter linhas guia dos pinos');
    assert.ok(texts.some((t) => t.text === 'DT04-12PA-L012'), 'Deve conter o código do modelo em texto');
});

test('documentToElmt exporta XML compatível e executa roundtrip sem perda de terminais', () => {
    const doc = {
        name: 'sensor_indutivo.elmt',
        sourceFormat: 'elmt',
        layers: [
            { name: ELMT_DEFAULT_LAYER, color: '#ffffff' },
            { name: ELMT_TERMINAL_LAYER, color: '#ef4444' },
        ],
        elmtMetadata: {
            uuid: '{33333333-4444-5555-6666-777777777777}',
            names: { pt: 'Sensor Indutivo NPN', en: 'Inductive Sensor NPN' },
            informations: 'Sensor M12 24V',
            width: 120,
            height: 60,
            hotspot_x: 60,
            hotspot_y: 30,
            version: '0.80',
            link_type: 'simple',
        },
        entities: [
            {
                id: 'l1',
                type: 'line',
                layer: ELMT_DEFAULT_LAYER,
                start: { x: -40, y: 0 },
                end: { x: 40, y: 0 },
            },
            {
                id: 't1',
                type: 'terminal',
                layer: ELMT_TERMINAL_LAYER,
                position: { x: -40, y: 0 },
                orientation: 'w',
                name: 'BN+',
                uuid: '{term-0001}',
                terminalType: 'Generic',
            },
            {
                id: 't2',
                type: 'terminal',
                layer: ELMT_TERMINAL_LAYER,
                position: { x: 40, y: 0 },
                orientation: 'e',
                name: 'BK_OUT',
                uuid: '{term-0002}',
                terminalType: 'Generic',
            },
        ],
    };

    const xml = documentToElmt(doc);
    assert.ok(looksLikeElmt(xml));
    assert.ok(xml.includes('BN+'));
    assert.ok(xml.includes('BK_OUT'));
    assert.ok(xml.includes('orientation="w"'));
    assert.ok(xml.includes('orientation="e"'));
    assert.ok(xml.includes('Sensor Indutivo NPN'));

    // Roundtrip de volta para documento
    const reimported = elmtToDocument(xml, { name: 'sensor_indutivo.elmt' });
    assert.equal(reimported.sourceFormat, 'elmt');
    assert.equal(reimported.elmtMetadata.names.pt, 'Sensor Indutivo NPN');

    const reimportedTerminals = reimported.entities.filter((e) => e.type === 'terminal');
    assert.equal(reimportedTerminals.length, 2);

    const t1 = reimportedTerminals.find((t) => t.name === 'BN+');
    assert.ok(t1);
    assert.equal(t1.position.x, -40);
    assert.equal(t1.position.y, 0);
    assert.equal(t1.orientation, 'w');
    assert.equal(t1.uuid, '{term-0001}');

    const t2 = reimportedTerminals.find((t) => t.name === 'BK_OUT');
    assert.ok(t2);
    assert.equal(t2.position.x, 40);
    assert.equal(t2.position.y, 0);
    assert.equal(t2.orientation, 'e');
    assert.equal(t2.uuid, '{term-0002}');
});

test('snaps e grips para terminais elétricos', () => {
    const terminal = {
        id: 'term_01',
        type: 'terminal',
        layer: ELMT_TERMINAL_LAYER,
        position: { x: 15, y: 25 },
        orientation: 'e',
        name: 'PIN_1',
        uuid: '{term-test}',
    };

    // Grips
    const grips = getEntityGrips(terminal);
    assert.equal(grips.length, 1);
    assert.equal(grips[0].type, 'position');
    assert.deepEqual(grips[0].point, { x: 15, y: 25 });

    // Move grip
    const moved = applyGripMove(terminal, grips[0], { x: 50, y: 60 });
    assert.deepEqual(moved.position, { x: 50, y: 60 });
    assert.equal(moved.orientation, 'e');
    assert.equal(moved.name, 'PIN_1');

    // Snap points (cen e nod)
    const provider = entityProvider('terminal');
    assert.ok(provider);
    const snaps = provider.snapPoints(terminal);
    assert.ok(snaps.some((s) => s.mode === 'nod' && s.point.x === 15 && s.point.y === 25));
    assert.ok(snaps.some((s) => s.mode === 'cen' && s.point.x === 15 && s.point.y === 25));

    // Mirroring horizontal inverte orientation 'e' para 'w'
    const mirrored = provider.transform(terminal, (p) => ({ x: -p.x, y: p.y }), true);
    assert.equal(mirrored.position.x, -15);
    assert.equal(mirrored.position.y, 25);
    assert.equal(mirrored.orientation, 'w', 'Espelhar deve inverter orientação leste para oeste');
});
