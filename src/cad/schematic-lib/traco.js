// Biblioteca embutida do próprio Traço: peças de desenho do esquema que não são componente.
// Formato traco-simbolo v1 (ADR 0007). O conector de página (`conector: true`) liga as redes de
// todos os conectores com o mesmo `sinal`, em qualquer folha; não entra na lista de peças.

export default {
    manifesto: {
        formato: 'traco-biblioteca',
        id: 'traco',
        nome: 'Traço',
        simbolos: ['conector-pagina.json'],
        versao: 1,
        versao_biblioteca: '1.0.0',
    },
    simbolos: [
        {
            formato: 'traco-simbolo',
            versao: 1,
            id: 'conector-pagina',
            nome: 'Conector de página',
            categoria: 'conector',
            unidade: 'mm',
            conector: true,
            geometria: [
                { type: 'line', start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
                {
                    type: 'polyline',
                    closed: true,
                    vertices: [
                        { x: 5, y: -3, bulge: 0 },
                        { x: 17, y: -3, bulge: 0 },
                        { x: 20, y: 0, bulge: 0 },
                        { x: 17, y: 3, bulge: 0 },
                        { x: 5, y: 3, bulge: 0 },
                    ],
                },
            ],
            portas: [
                { name: 'X', position: { x: 0, y: 0 }, orientation: 'w', type: 'passante', required: true },
            ],
            atributos: [
                { nome: 'etiqueta', prefixo: 'X', visivel: false },
                { nome: 'sinal', visivel: true, posicao: { x: 6.5, y: -1.25 }, altura: 2.5 },
            ],
        },
    ],
};
