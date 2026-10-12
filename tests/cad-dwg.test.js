import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertDwg } from '../src/cad/dwg.js';

globalThis.document = { querySelector: () => ({ content: 'csrf-test' }) };
const file = new File(['AC1027'], 'part.dwg');
test('DWG envia multipart autenticado e retorna DXF', async () => {
    const dxf = '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n';
    assert.equal(await convertDwg(file, '/cad/dwg/convert', async (url, options) => {
        assert.equal(options.method, 'POST');
        assert.equal(options.credentials, 'same-origin');
        assert.equal(options.headers['X-CSRF-TOKEN'], 'csrf-test');
        assert.equal(options.body.get('file').name, 'part.dwg');
        return new Response(dxf);
    }), dxf);
});
test('DWG comunica erro do servidor e rejeita resposta não DXF', async () => {
    await assert.rejects(convertDwg(file, '/convert', async () => new Response('{"message":"Conversor indisponível"}', {status:503})), /Conversor indisponível/);
    await assert.rejects(convertDwg(file, '/convert', async () => new Response('<html>login</html>')), /DXF válido/);
});
test('DWG verifica limite e configuração antes do upload', async () => {
    await assert.rejects(convertDwg({size:20971521}, '/convert'), /20 MB/);
    await assert.rejects(convertDwg(file, ''), /não configurada/);
});
