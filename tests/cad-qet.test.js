import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
    looksLikeQet,
    rotateQetPoint,
    rotateCardinal,
    qetToDocuments,
    documentToQet,
    QET_LAYER_BORDER,
    QET_LAYER_CONDUCTORS,
    QET_LAYER_COMPONENTS,
    QET_LAYER_TERMINALS,
    QET_LAYER_TEXTS,
} from '../src/cad/qet.js';

test('looksLikeQet detecta formato QElectroTech Project (.qet) corretamente', () => {
    assert.equal(looksLikeQet('<project version="0.90"><diagrams><diagram title="Chicote"/></diagrams></project>'), true);
    assert.equal(looksLikeQet('<?xml version="1.0" encoding="utf-8"?>\n<project title="Exemplo"><diagram/></project>'), true);

    const buf = new TextEncoder().encode('<project><collection><element/></collection></project>');
    assert.equal(looksLikeQet(buf), true);
    assert.equal(looksLikeQet(buf.buffer), true);

    // Falsos positivos
    assert.equal(looksLikeQet('<definition width="100" height="100" type="element"/>'), false);
    assert.equal(looksLikeQet('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), false);
    assert.equal(looksLikeQet('0\nSECTION\n2\nHEADER\n0\nENDSEC'), false);
    assert.equal(looksLikeQet('{"name": "test"}'), false);
    assert.equal(looksLikeQet(''), false);
    assert.equal(looksLikeQet(null), false);
    assert.equal(looksLikeQet(undefined), false);
});

test('rotateQetPoint e rotateCardinal transformam coordenadas e orientações corretamente', () => {
    const pt = { x: 10, y: 20 };

    // 0 = 0 deg
    assert.deepEqual(rotateQetPoint(pt.x, pt.y, 0), { x: 10, y: 20 });
    assert.equal(rotateCardinal('n', 0), 'n');

    // 1 = 90 deg cw (x' = -y, y' = x)
    assert.deepEqual(rotateQetPoint(pt.x, pt.y, 1), { x: -20, y: 10 });
    assert.equal(rotateCardinal('n', 1), 'e');
    assert.equal(rotateCardinal('e', 1), 's');
    assert.equal(rotateCardinal('s', 1), 'w');
    assert.equal(rotateCardinal('w', 1), 'n');

    // 2 = 180 deg (x' = -x, y' = -y)
    assert.deepEqual(rotateQetPoint(pt.x, pt.y, 2), { x: -10, y: -20 });
    assert.equal(rotateCardinal('n', 2), 's');

    // 3 = 270 deg cw (x' = y, y' = -x)
    assert.deepEqual(rotateQetPoint(pt.x, pt.y, 3), { x: 20, y: -10 });
    assert.equal(rotateCardinal('n', 3), 'w');
});

test('qetToDocuments importa projeto sintético multifolha com elementos, moldura e condutores', () => {
    const syntheticXml = `<?xml version="1.0" encoding="utf-8"?>
<project version="0.80" title="Chicote Agro">
    <collection>
        <element name="rele">
            <definition width="60" height="40" hotspot_x="30" hotspot_y="20" type="element">
                <description>
                    <rect width="40" height="20" x="-20" y="-10"/>
                    <terminal x="-20" y="0" orientation="w" name="1" type="Generic"/>
                    <terminal x="20" y="0" orientation="e" name="2" type="Generic"/>
                </description>
            </definition>
        </element>
    </collection>
    <diagrams>
        <diagram title="Alimentação" order="1" width="1050" height="740">
            <border colspacing="100" rowspacing="100" cols="10" rows="7"/>
            <inset title="Folha de Força" author="Exemplo Engenharia" date="2027-01-10" plant="Plataforma Exemplo"/>
            <elements>
                <element type="rele" x="200" y="300" orientation="0">
                    <terminals>
                        <terminal uuid="{term-1-uuid}"/>
                        <terminal uuid="{term-2-uuid}"/>
                    </terminals>
                </element>
                <element type="rele" x="500" y="300" orientation="0">
                    <terminals>
                        <terminal uuid="{term-3-uuid}"/>
                        <terminal uuid="{term-4-uuid}"/>
                    </terminals>
                </element>
            </elements>
            <conductors>
                <conductor terminal1="{term-2-uuid}" terminal2="{term-3-uuid}" type="multi" num="CAN_H">
                    <segment orientation="horizontal" length="300"/>
                </conductor>
            </conductors>
            <texts>
                <text x="100" y="100" text="Barramento Principal" size="9"/>
            </texts>
        </diagram>
    </diagrams>
</project>`;

    const docs = qetToDocuments(syntheticXml, { name: 'projeto_teste.qet' });

    assert.equal(docs.length, 1);
    const doc = docs[0];

    assert.equal(doc.sourceFormat, 'qet');
    assert.equal(doc.name, 'Alimentação');
    assert.equal(doc.qetProject.title, 'Chicote Agro');
    assert.equal(doc.qetDiagram.title, 'Alimentação');
    assert.equal(doc.qetDiagram.insetTitle, 'Folha de Força');

    // Layers
    const layerNames = doc.layers.map((l) => l.name);
    assert.ok(layerNames.includes(QET_LAYER_BORDER));
    assert.ok(layerNames.includes(QET_LAYER_CONDUCTORS));
    assert.ok(layerNames.includes(QET_LAYER_COMPONENTS));
    assert.ok(layerNames.includes(QET_LAYER_TERMINALS));
    assert.ok(layerNames.includes(QET_LAYER_TEXTS));

    // Entidades de moldura
    const borders = doc.entities.filter(e => e.layer === QET_LAYER_BORDER);
    assert.ok(borders.length >= 4, 'Deve conter as linhas da moldura');

    // Entidades de elementos instanciados
    const elemEntities = doc.entities.filter(e => e.layer === QET_LAYER_COMPONENTS);
    assert.ok(elemEntities.length >= 2, 'Deve ter instanciado os 2 relés');

    // Terminais
    const terminals = doc.entities.filter(e => e.layer === QET_LAYER_TERMINALS);
    assert.equal(terminals.length, 4, 'Deve ter criado 4 terminais no total');

    // Condutor
    const conductors = doc.entities.filter(e => e.layer === QET_LAYER_CONDUCTORS);
    assert.ok(conductors.length >= 1, 'Deve ter criado o condutor conectando os relés');
    const c1 = conductors.find(e => e.wireText === 'CAN_H' || e.wireNumber === 'CAN_H');
    assert.ok(c1, 'Condutor CAN_H deve existir com metadados');

    // Textos
    const texts = doc.entities.filter(e => e.layer === QET_LAYER_TEXTS);
    const mainText = texts.find(t => t.text === 'Barramento Principal');
    assert.ok(mainText, 'Texto independente deve ter sido criado');
});

test('qetToDocuments abre com precisão o projeto real Chicote-Duo-Mini-2027.qet da Exemplo Engenharia', () => {
    const realFilePath = '/Users/usuario/Documents/exemplo.qet';
    if (!existsSync(realFilePath)) {
        return; // Arquivo não disponível neste ambiente, pular
    }

    const xml = readFileSync(realFilePath, 'utf-8');
    assert.equal(looksLikeQet(xml), true);

    const docs = qetToDocuments(xml, { name: 'Chicote-Duo-Mini-2027.qet' });
    assert.ok(docs.length >= 1, 'Deve carregar ao menos 1 diagrama');

    const doc = docs[0];
    assert.equal(doc.sourceFormat, 'qet');

    // Contagem de elementos e condutores
    const elements = doc.entities.filter(e => e.layer === QET_LAYER_COMPONENTS);
    const terminals = doc.entities.filter(e => e.layer === QET_LAYER_TERMINALS);
    const conductors = doc.entities.filter(e => e.layer === QET_LAYER_CONDUCTORS);

    assert.ok(elements.length > 20, `Esperado mais de 20 elementos, obteve ${elements.length}`);
    assert.ok(terminals.length > 50, `Esperado mais de 50 terminais, obteve ${terminals.length}`);
    assert.ok(conductors.length > 50, `Esperado mais de 50 condutores, obteve ${conductors.length}`);

    // Verificar condutores com nomes típicos do chicote
    const wireTexts = conductors.map(c => c.wireText || c.wireNumber || '').filter(Boolean);
    const hasCanH = wireTexts.some(t => t.includes('CAN') || t.includes('H'));
    const hasPower = wireTexts.some(t => t.includes('12') || t.includes('V') || t.includes('GND') || t.includes('TERRA'));
    assert.ok(hasCanH || hasPower, 'Deve conter redes de alimentação ou CAN');

    // Validar integridade geométrica: nenhum condutor pode ter NaN
    for (const c of conductors) {
        if (c.type === 'line') {
            assert.ok(!Number.isNaN(c.x1) && !Number.isNaN(c.y1) && !Number.isNaN(c.x2) && !Number.isNaN(c.y2));
        } else if (c.type === 'lwpolyline') {
            for (const pt of c.vertices) {
                assert.ok(!Number.isNaN(pt.x) && !Number.isNaN(pt.y));
            }
        }
    }
});

test('documentToQet exporta projeto QET e permite roundtrip de reimportação', () => {
    const doc = {
        sourceFormat: 'qet',
        name: 'Chicote Export',
        entities: [
            {
                type: 'line',
                x1: 0,
                y1: 0,
                x2: 100,
                y2: 0,
                layer: QET_LAYER_CONDUCTORS,
                wireNumber: 'W101',
                wireColor: '#0000ff',
            },
            {
                type: 'point',
                x: 0,
                y: 0,
                layer: QET_LAYER_TERMINALS,
                name: 'T1',
                uuid: '{t1-uuid}',
            },
            {
                type: 'point',
                x: 100,
                y: 0,
                layer: QET_LAYER_TERMINALS,
                name: 'T2',
                uuid: '{t2-uuid}',
            },
            {
                type: 'text',
                x: 50,
                y: 10,
                text: 'Relé de Partida',
                height: 4,
                layer: QET_LAYER_TEXTS,
            },
        ],
        layers: {
            [QET_LAYER_CONDUCTORS]: { name: QET_LAYER_CONDUCTORS, color: '#0055d4' },
            [QET_LAYER_TERMINALS]: { name: QET_LAYER_TERMINALS, color: '#dc2626' },
            [QET_LAYER_TEXTS]: { name: QET_LAYER_TEXTS, color: '#16a34a' },
        },
        qetProject: {
            title: 'Chicote Export',
            version: '0.90',
        },
        qetDiagram: {
            title: 'Folha 1',
            width: 1000,
            height: 700,
        },
    };

    const xml = documentToQet(doc);
    assert.ok(xml.startsWith('<?xml'));
    assert.ok(xml.includes('<project'));
    assert.ok(xml.includes('<diagram'));
    assert.ok(xml.includes('<conductors>'));
    assert.ok(xml.includes('W101'));

    // Roundtrip
    const reimportedDocs = qetToDocuments(xml, { name: 'reimported.qet' });
    assert.equal(reimportedDocs.length, 1);
    const reimported = reimportedDocs[0];
    assert.equal(reimported.sourceFormat, 'qet');

    const cond = reimported.entities.find(e => e.layer === QET_LAYER_CONDUCTORS);
    assert.ok(cond);
    assert.equal(cond.wireNumber, 'W101');
});

test('carimbo da folha usa o autor do projeto, sem nome de empresa fixo', () => {
    const xml = (inset) => `<?xml version="1.0" encoding="utf-8"?>
<project version="0.80" title="Painel">
    <diagrams>
        <diagram title="Força" order="1">
            ${inset}
            <elements/>
        </diagram>
    </diagrams>
</project>`;
    const texts = (doc) => doc.entities.filter((e) => e.type === 'text').map((e) => e.text);

    const [comAutor] = qetToDocuments(xml('<inset title="Força" author="Oficina Elétrica"/>'), { name: 'painel.qet' });
    assert.ok(texts(comAutor).includes('Oficina Elétrica'), 'autor do inset no carimbo');
    assert.ok(!texts(comAutor).some((t) => /Exemplo Engenharia/.test(t)), 'sem empresa fixa no carimbo');

    const [semAutor] = qetToDocuments(xml(''), { name: 'painel.qet' });
    assert.ok(!texts(semAutor).some((t) => /Exemplo Engenharia/.test(t)), 'sem empresa fixa sem autor');
    assert.ok(!semAutor.entities.some((e) => e.id?.startsWith('tb_t3')), 'sem linha de autor quando o projeto não tem');
});
