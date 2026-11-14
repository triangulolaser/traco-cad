// Biblioteca ISO 1219-1 genérica embutida no Traço (formato traco-simbolo v1).
// Gerada a partir dos arquivos JSON da biblioteca; as portas usam as chaves do terminal.
// Não editar à mão: refazer pelo gerador da biblioteca e converter de novo.

export default {
  "manifesto": {
    "formato": "traco-biblioteca",
    "id": "iso1219",
    "nome": "ISO 1219-1 genérica",
    "simbolos": [
      "bomba-variavel-ls.json",
      "valvula-4-3-centro-fechado.json",
      "cilindro-dupla-acao.json",
      "motor-bidirecional-dreno.json",
      "tanque.json",
      "bomba-fixa.json",
      "bomba-fixa-dupla.json",
      "bomba-variavel-bidirecional-eletrica.json",
      "motor-unidirecional.json",
      "motor-bidirecional.json",
      "motor-duas-cilindradas-dreno.json",
      "valvula-4-3-proporcional-ls.json",
      "valvula-4-3-alavanca-ls.json",
      "valvula-2-2-solenoide-nf.json",
      "valvula-3-2-solenoide.json",
      "retencao-dupla-pilotada.json",
      "filtro.json",
      "resfriador.json",
      "unidade-direcao-ls.json",
      "valvula-alivio.json"
    ],
    "versao": 1,
    "versao_biblioteca": "0.2.0"
  },
  "simbolos": [
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": -16.0,
            "y": 13.0
          },
          "prefixo": "B",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "bomba",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "center": {
            "x": 0.0,
            "y": 0.0
          },
          "radius": 10.0,
          "type": "circle"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 0.0,
                  "y": 10.0
                },
                {
                  "bulge": 0,
                  "x": -3.0,
                  "y": 5.0
                },
                {
                  "bulge": 0,
                  "x": 3.0,
                  "y": 5.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 9.88,
            "y": 9.88
          },
          "start": {
            "x": -12.0,
            "y": -12.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 12.0,
                  "y": 12.0
                },
                {
                  "bulge": 0,
                  "x": 9.03,
                  "y": 10.73
                },
                {
                  "bulge": 0,
                  "x": 10.73,
                  "y": 9.03
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 0.0,
            "y": 15.0
          },
          "start": {
            "x": 0.0,
            "y": 10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": -15.0
          },
          "start": {
            "x": 0.0,
            "y": -10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -16.0,
            "y": 1.0
          },
          "start": {
            "x": -10.0,
            "y": 1.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -16.0,
            "y": -1.0
          },
          "start": {
            "x": -10.0,
            "y": -1.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 15.0,
            "y": 0.0
          },
          "start": {
            "x": 10.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 15.0,
              "y": -4.0
            },
            {
              "bulge": 0,
              "x": 25.0,
              "y": -4.0
            },
            {
              "bulge": 0,
              "x": 25.0,
              "y": 4.0
            },
            {
              "bulge": 0,
              "x": 15.0,
              "y": 4.0
            }
          ]
        },
        {
          "closed": false,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 25.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 26.0,
              "y": 2.5
            },
            {
              "bulge": 0,
              "x": 27.0,
              "y": -2.5
            },
            {
              "bulge": 0,
              "x": 28.0,
              "y": 2.5
            },
            {
              "bulge": 0,
              "x": 29.0,
              "y": -2.5
            },
            {
              "bulge": 0,
              "x": 30.0,
              "y": 2.5
            },
            {
              "bulge": 0,
              "x": 31.0,
              "y": -2.5
            },
            {
              "bulge": 0,
              "x": 32.0,
              "y": 2.5
            },
            {
              "bulge": 0,
              "x": 33.0,
              "y": 0.0
            }
          ]
        },
        {
          "end": {
            "x": 20.0,
            "y": -15.0
          },
          "lineType": "DASHED",
          "start": {
            "x": 20.0,
            "y": -4.0
          },
          "type": "line"
        },
        {
          "closed": false,
          "lineType": "DASHED",
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 7.07,
              "y": -7.07
            },
            {
              "bulge": 0,
              "x": 10.0,
              "y": -10.0
            },
            {
              "bulge": 0,
              "x": 10.0,
              "y": -15.0
            }
          ]
        }
      ],
      "id": "bomba-variavel-ls",
      "nome": "Bomba de deslocamento variável com regulador LS",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "P",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 15.0
          },
          "required": true,
          "type": "pressao"
        },
        {
          "name": "S",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": true,
          "type": "succao"
        },
        {
          "name": "LS",
          "orientation": "s",
          "position": {
            "x": 20.0,
            "y": -15.0
          },
          "required": true,
          "type": "piloto"
        },
        {
          "name": "L",
          "orientation": "s",
          "position": {
            "x": 10.0,
            "y": -15.0
          },
          "required": true,
          "type": "dreno"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": -46.0,
            "y": 23.0
          },
          "prefixo": "V",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "valvula",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -30.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 30.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 30.0,
              "y": 20.0
            },
            {
              "bulge": 0,
              "x": -30.0,
              "y": 20.0
            }
          ]
        },
        {
          "end": {
            "x": -10.0,
            "y": 20.0
          },
          "start": {
            "x": -10.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 10.0,
            "y": 20.0
          },
          "start": {
            "x": 10.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -5.0,
            "y": 4.0
          },
          "start": {
            "x": -5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -3.0,
            "y": 4.0
          },
          "start": {
            "x": -7.0,
            "y": 4.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": 4.0
          },
          "start": {
            "x": 5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 7.0,
            "y": 4.0
          },
          "start": {
            "x": 3.0,
            "y": 4.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -5.0,
            "y": 16.0
          },
          "start": {
            "x": -5.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -3.0,
            "y": 16.0
          },
          "start": {
            "x": -7.0,
            "y": 16.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": 16.0
          },
          "start": {
            "x": 5.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 7.0,
            "y": 16.0
          },
          "start": {
            "x": 3.0,
            "y": 16.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -25.0,
            "y": 17.0
          },
          "start": {
            "x": -25.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -25.0,
                  "y": 20.0
                },
                {
                  "bulge": 0,
                  "x": -26.2,
                  "y": 17.0
                },
                {
                  "bulge": 0,
                  "x": -23.8,
                  "y": 17.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": -15.0,
            "y": 3.0
          },
          "start": {
            "x": -15.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -15.0,
                  "y": 0.0
                },
                {
                  "bulge": 0,
                  "x": -13.8,
                  "y": 3.0
                },
                {
                  "bulge": 0,
                  "x": -16.2,
                  "y": 3.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 23.66,
            "y": 17.32
          },
          "start": {
            "x": 15.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 25.0,
                  "y": 20.0
                },
                {
                  "bulge": 0,
                  "x": 22.59,
                  "y": 17.85
                },
                {
                  "bulge": 0,
                  "x": 24.73,
                  "y": 16.78
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 23.66,
            "y": 2.68
          },
          "start": {
            "x": 15.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 25.0,
                  "y": 0.0
                },
                {
                  "bulge": 0,
                  "x": 24.73,
                  "y": 3.22
                },
                {
                  "bulge": 0,
                  "x": 22.59,
                  "y": 2.15
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "closed": false,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -38.0,
              "y": 10.0
            },
            {
              "bulge": 0,
              "x": -37.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": -36.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": -35.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": -34.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": -33.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": -32.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": -31.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": -30.0,
              "y": 10.0
            }
          ]
        },
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -46.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": -38.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": -38.0,
              "y": 15.0
            },
            {
              "bulge": 0,
              "x": -46.0,
              "y": 15.0
            }
          ]
        },
        {
          "end": {
            "x": -38.0,
            "y": 15.0
          },
          "start": {
            "x": -46.0,
            "y": 5.0
          },
          "type": "line"
        },
        {
          "closed": false,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 30.0,
              "y": 10.0
            },
            {
              "bulge": 0,
              "x": 31.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 32.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": 33.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 34.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": 35.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 36.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": 37.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 38.0,
              "y": 10.0
            }
          ]
        },
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 38.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": 46.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": 46.0,
              "y": 15.0
            },
            {
              "bulge": 0,
              "x": 38.0,
              "y": 15.0
            }
          ]
        },
        {
          "end": {
            "x": 46.0,
            "y": 15.0
          },
          "start": {
            "x": 38.0,
            "y": 5.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -5.0,
            "y": -5.0
          },
          "start": {
            "x": -5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": -5.0
          },
          "start": {
            "x": 5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -5.0,
            "y": 25.0
          },
          "start": {
            "x": -5.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": 25.0
          },
          "start": {
            "x": 5.0,
            "y": 20.0
          },
          "type": "line"
        }
      ],
      "id": "valvula-4-3-centro-fechado",
      "nome": "Válvula direcional 4/3, centro fechado, solenoide e mola",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "P",
          "orientation": "s",
          "position": {
            "x": -5.0,
            "y": -5.0
          },
          "required": true,
          "type": "pressao"
        },
        {
          "name": "T",
          "orientation": "s",
          "position": {
            "x": 5.0,
            "y": -5.0
          },
          "required": true,
          "type": "retorno"
        },
        {
          "name": "A",
          "orientation": "n",
          "position": {
            "x": -5.0,
            "y": 25.0
          },
          "required": true,
          "type": "trabalho"
        },
        {
          "name": "B",
          "orientation": "n",
          "position": {
            "x": 5.0,
            "y": 25.0
          },
          "required": true,
          "type": "trabalho"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": 0.0,
            "y": 18.0
          },
          "prefixo": "C",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "atuador",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 0.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 50.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 50.0,
              "y": 15.0
            },
            {
              "bulge": 0,
              "x": 0.0,
              "y": 15.0
            }
          ]
        },
        {
          "end": {
            "x": 15.0,
            "y": 15.0
          },
          "start": {
            "x": 15.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 65.0,
            "y": 6.0
          },
          "start": {
            "x": 15.0,
            "y": 6.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 65.0,
            "y": 9.0
          },
          "start": {
            "x": 15.0,
            "y": 9.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 65.0,
            "y": 9.0
          },
          "start": {
            "x": 65.0,
            "y": 6.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": -5.0
          },
          "start": {
            "x": 5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 45.0,
            "y": -5.0
          },
          "start": {
            "x": 45.0,
            "y": 0.0
          },
          "type": "line"
        }
      ],
      "id": "cilindro-dupla-acao",
      "nome": "Cilindro de dupla ação, haste simples",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "A",
          "orientation": "s",
          "position": {
            "x": 5.0,
            "y": -5.0
          },
          "required": true,
          "type": "trabalho"
        },
        {
          "name": "B",
          "orientation": "s",
          "position": {
            "x": 45.0,
            "y": -5.0
          },
          "required": true,
          "type": "trabalho"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": -16.0,
            "y": 13.0
          },
          "prefixo": "M",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "atuador",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "center": {
            "x": 0.0,
            "y": 0.0
          },
          "radius": 10.0,
          "type": "circle"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -3.0,
                  "y": 9.54
                },
                {
                  "bulge": 0,
                  "x": 3.0,
                  "y": 9.54
                },
                {
                  "bulge": 0,
                  "x": 0.0,
                  "y": 5.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -3.0,
                  "y": -9.54
                },
                {
                  "bulge": 0,
                  "x": 3.0,
                  "y": -9.54
                },
                {
                  "bulge": 0,
                  "x": 0.0,
                  "y": -5.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 0.0,
            "y": 15.0
          },
          "start": {
            "x": 0.0,
            "y": 10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": -15.0
          },
          "start": {
            "x": 0.0,
            "y": -10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 16.0,
            "y": 1.0
          },
          "start": {
            "x": 10.0,
            "y": 1.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 16.0,
            "y": -1.0
          },
          "start": {
            "x": 10.0,
            "y": -1.0
          },
          "type": "line"
        },
        {
          "closed": false,
          "lineType": "DASHED",
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 7.07,
              "y": -7.07
            },
            {
              "bulge": 0,
              "x": 10.0,
              "y": -10.0
            },
            {
              "bulge": 0,
              "x": 10.0,
              "y": -15.0
            }
          ]
        }
      ],
      "id": "motor-bidirecional-dreno",
      "nome": "Motor hidráulico bidirecional com dreno externo",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "A",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 15.0
          },
          "required": true,
          "type": "trabalho"
        },
        {
          "name": "B",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": true,
          "type": "trabalho"
        },
        {
          "name": "L",
          "orientation": "s",
          "position": {
            "x": 10.0,
            "y": -15.0
          },
          "required": true,
          "type": "dreno"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": 12.0,
            "y": 0.0
          },
          "prefixo": "R",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "reservatorio",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "closed": false,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -10.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": -10.0,
              "y": -5.0
            },
            {
              "bulge": 0,
              "x": 10.0,
              "y": -5.0
            },
            {
              "bulge": 0,
              "x": 10.0,
              "y": 5.0
            }
          ]
        },
        {
          "end": {
            "x": 0.0,
            "y": -2.0
          },
          "start": {
            "x": 0.0,
            "y": 10.0
          },
          "type": "line"
        }
      ],
      "id": "tanque",
      "nome": "Reservatório aberto, retorno abaixo do nível",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "T",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 10.0
          },
          "required": true,
          "type": "retorno"
        }
      ],
      "rede_global": "tanque",
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": -16.0,
            "y": 13.0
          },
          "prefixo": "B",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "bomba",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "center": {
            "x": 0.0,
            "y": 0.0
          },
          "radius": 10.0,
          "type": "circle"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 0.0,
                  "y": 10.0
                },
                {
                  "bulge": 0,
                  "x": -3.0,
                  "y": 5.0
                },
                {
                  "bulge": 0,
                  "x": 3.0,
                  "y": 5.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 0.0,
            "y": 15.0
          },
          "start": {
            "x": 0.0,
            "y": 10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": -15.0
          },
          "start": {
            "x": 0.0,
            "y": -10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -16.0,
            "y": 1.0
          },
          "start": {
            "x": -10.0,
            "y": 1.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -16.0,
            "y": -1.0
          },
          "start": {
            "x": -10.0,
            "y": -1.0
          },
          "type": "line"
        }
      ],
      "id": "bomba-fixa",
      "nome": "Bomba de deslocamento fixo, um sentido",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "P",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 15.0
          },
          "required": true,
          "type": "pressao"
        },
        {
          "name": "S",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": true,
          "type": "succao"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": -16.0,
            "y": 13.0
          },
          "prefixo": "B",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "bomba",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "center": {
            "x": 0.0,
            "y": 0.0
          },
          "radius": 10.0,
          "type": "circle"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 0.0,
                  "y": 10.0
                },
                {
                  "bulge": 0,
                  "x": -3.0,
                  "y": 5.0
                },
                {
                  "bulge": 0,
                  "x": 3.0,
                  "y": 5.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 0.0,
            "y": 15.0
          },
          "start": {
            "x": 0.0,
            "y": 10.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 30.0,
            "y": 0.0
          },
          "radius": 10.0,
          "type": "circle"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 30.0,
                  "y": 10.0
                },
                {
                  "bulge": 0,
                  "x": 27.0,
                  "y": 5.0
                },
                {
                  "bulge": 0,
                  "x": 33.0,
                  "y": 5.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 30.0,
            "y": 15.0
          },
          "start": {
            "x": 30.0,
            "y": 10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 20.0,
            "y": 1.0
          },
          "start": {
            "x": 10.0,
            "y": 1.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 20.0,
            "y": -1.0
          },
          "start": {
            "x": 10.0,
            "y": -1.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -16.0,
            "y": 1.0
          },
          "start": {
            "x": -10.0,
            "y": 1.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -16.0,
            "y": -1.0
          },
          "start": {
            "x": -10.0,
            "y": -1.0
          },
          "type": "line"
        },
        {
          "closed": false,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 0.0,
              "y": -10.0
            },
            {
              "bulge": 0,
              "x": 0.0,
              "y": -12.0
            },
            {
              "bulge": 0,
              "x": 30.0,
              "y": -12.0
            },
            {
              "bulge": 0,
              "x": 30.0,
              "y": -10.0
            }
          ]
        },
        {
          "end": {
            "x": 15.0,
            "y": -15.0
          },
          "start": {
            "x": 15.0,
            "y": -12.0
          },
          "type": "line"
        }
      ],
      "id": "bomba-fixa-dupla",
      "nome": "Bomba dupla de deslocamento fixo, eixo comum e sucção comum",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "P1",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 15.0
          },
          "required": true,
          "type": "pressao"
        },
        {
          "name": "P2",
          "orientation": "n",
          "position": {
            "x": 30.0,
            "y": 15.0
          },
          "required": true,
          "type": "pressao"
        },
        {
          "name": "S",
          "orientation": "s",
          "position": {
            "x": 15.0,
            "y": -15.0
          },
          "required": true,
          "type": "succao"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": -16.0,
            "y": 13.0
          },
          "prefixo": "B",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "bomba",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "center": {
            "x": 0.0,
            "y": 0.0
          },
          "radius": 10.0,
          "type": "circle"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 0.0,
                  "y": 10.0
                },
                {
                  "bulge": 0,
                  "x": -3.0,
                  "y": 5.0
                },
                {
                  "bulge": 0,
                  "x": 3.0,
                  "y": 5.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 0.0,
                  "y": -10.0
                },
                {
                  "bulge": 0,
                  "x": -3.0,
                  "y": -5.0
                },
                {
                  "bulge": 0,
                  "x": 3.0,
                  "y": -5.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 9.88,
            "y": 9.88
          },
          "start": {
            "x": -12.0,
            "y": -12.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 12.0,
                  "y": 12.0
                },
                {
                  "bulge": 0,
                  "x": 9.03,
                  "y": 10.73
                },
                {
                  "bulge": 0,
                  "x": 10.73,
                  "y": 9.03
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 0.0,
            "y": 15.0
          },
          "start": {
            "x": 0.0,
            "y": 10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": -15.0
          },
          "start": {
            "x": 0.0,
            "y": -10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -16.0,
            "y": 1.0
          },
          "start": {
            "x": -10.0,
            "y": 1.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -16.0,
            "y": -1.0
          },
          "start": {
            "x": -10.0,
            "y": -1.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 15.0,
            "y": 0.0
          },
          "start": {
            "x": 10.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 15.0,
              "y": -5.0
            },
            {
              "bulge": 0,
              "x": 23.0,
              "y": -5.0
            },
            {
              "bulge": 0,
              "x": 23.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": 15.0,
              "y": 5.0
            }
          ]
        },
        {
          "end": {
            "x": 23.0,
            "y": 5.0
          },
          "start": {
            "x": 15.0,
            "y": -5.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 23.37,
            "y": 5.1
          },
          "start": {
            "x": 13.0,
            "y": -7.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 25.0,
                  "y": 7.0
                },
                {
                  "bulge": 0,
                  "x": 22.61,
                  "y": 5.75
                },
                {
                  "bulge": 0,
                  "x": 24.13,
                  "y": 4.45
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "closed": false,
          "lineType": "DASHED",
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 7.07,
              "y": -7.07
            },
            {
              "bulge": 0,
              "x": 10.0,
              "y": -10.0
            },
            {
              "bulge": 0,
              "x": 10.0,
              "y": -15.0
            }
          ]
        },
        {
          "closed": false,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -7.07,
              "y": -7.07
            },
            {
              "bulge": 0,
              "x": -10.0,
              "y": -10.0
            },
            {
              "bulge": 0,
              "x": -10.0,
              "y": -15.0
            }
          ]
        }
      ],
      "id": "bomba-variavel-bidirecional-eletrica",
      "nome": "Bomba de deslocamento variável, dois sentidos (circuito fechado), comando elétrico proporcional, com bomba de carga",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "A",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 15.0
          },
          "required": true,
          "type": "trabalho"
        },
        {
          "name": "B",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": true,
          "type": "trabalho"
        },
        {
          "name": "L",
          "orientation": "s",
          "position": {
            "x": 10.0,
            "y": -15.0
          },
          "required": true,
          "type": "dreno"
        },
        {
          "name": "S",
          "orientation": "s",
          "position": {
            "x": -10.0,
            "y": -15.0
          },
          "required": true,
          "type": "succao"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": -16.0,
            "y": 13.0
          },
          "prefixo": "M",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "atuador",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "center": {
            "x": 0.0,
            "y": 0.0
          },
          "radius": 10.0,
          "type": "circle"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -3.0,
                  "y": 9.54
                },
                {
                  "bulge": 0,
                  "x": 3.0,
                  "y": 9.54
                },
                {
                  "bulge": 0,
                  "x": 0.0,
                  "y": 5.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 0.0,
            "y": 15.0
          },
          "start": {
            "x": 0.0,
            "y": 10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": -15.0
          },
          "start": {
            "x": 0.0,
            "y": -10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 16.0,
            "y": 1.0
          },
          "start": {
            "x": 10.0,
            "y": 1.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 16.0,
            "y": -1.0
          },
          "start": {
            "x": 10.0,
            "y": -1.0
          },
          "type": "line"
        }
      ],
      "id": "motor-unidirecional",
      "nome": "Motor hidráulico de deslocamento fixo, um sentido",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "A",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 15.0
          },
          "required": true,
          "type": "trabalho"
        },
        {
          "name": "B",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": true,
          "type": "retorno"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": -16.0,
            "y": 13.0
          },
          "prefixo": "M",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "atuador",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "center": {
            "x": 0.0,
            "y": 0.0
          },
          "radius": 10.0,
          "type": "circle"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -3.0,
                  "y": 9.54
                },
                {
                  "bulge": 0,
                  "x": 3.0,
                  "y": 9.54
                },
                {
                  "bulge": 0,
                  "x": 0.0,
                  "y": 5.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -3.0,
                  "y": -9.54
                },
                {
                  "bulge": 0,
                  "x": 3.0,
                  "y": -9.54
                },
                {
                  "bulge": 0,
                  "x": 0.0,
                  "y": -5.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 0.0,
            "y": 15.0
          },
          "start": {
            "x": 0.0,
            "y": 10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": -15.0
          },
          "start": {
            "x": 0.0,
            "y": -10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 16.0,
            "y": 1.0
          },
          "start": {
            "x": 10.0,
            "y": 1.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 16.0,
            "y": -1.0
          },
          "start": {
            "x": 10.0,
            "y": -1.0
          },
          "type": "line"
        }
      ],
      "id": "motor-bidirecional",
      "nome": "Motor hidráulico de deslocamento fixo, dois sentidos",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "A",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 15.0
          },
          "required": true,
          "type": "trabalho"
        },
        {
          "name": "B",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": true,
          "type": "trabalho"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": -16.0,
            "y": 13.0
          },
          "prefixo": "M",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "atuador",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "center": {
            "x": 0.0,
            "y": 0.0
          },
          "radius": 10.0,
          "type": "circle"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -3.0,
                  "y": 9.54
                },
                {
                  "bulge": 0,
                  "x": 3.0,
                  "y": 9.54
                },
                {
                  "bulge": 0,
                  "x": 0.0,
                  "y": 5.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -3.0,
                  "y": -9.54
                },
                {
                  "bulge": 0,
                  "x": 3.0,
                  "y": -9.54
                },
                {
                  "bulge": 0,
                  "x": 0.0,
                  "y": -5.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 0.0,
            "y": 15.0
          },
          "start": {
            "x": 0.0,
            "y": 10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": -15.0
          },
          "start": {
            "x": 0.0,
            "y": -10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 16.0,
            "y": 1.0
          },
          "start": {
            "x": 10.0,
            "y": 1.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 16.0,
            "y": -1.0
          },
          "start": {
            "x": 10.0,
            "y": -1.0
          },
          "type": "line"
        },
        {
          "closed": false,
          "lineType": "DASHED",
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 7.07,
              "y": -7.07
            },
            {
              "bulge": 0,
              "x": 10.0,
              "y": -10.0
            },
            {
              "bulge": 0,
              "x": 10.0,
              "y": -15.0
            }
          ]
        },
        {
          "end": {
            "x": -15.0,
            "y": 0.0
          },
          "lineType": "DASHED",
          "start": {
            "x": -10.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 6.53,
            "y": 8.98
          },
          "start": {
            "x": -8.0,
            "y": -11.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 8.0,
                  "y": 11.0
                },
                {
                  "bulge": 0,
                  "x": 5.72,
                  "y": 9.57
                },
                {
                  "bulge": 0,
                  "x": 7.34,
                  "y": 8.39
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        }
      ],
      "id": "motor-duas-cilindradas-dreno",
      "nome": "Motor hidráulico de duas cilindradas, dois sentidos, troca pilotada e dreno externo",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "A",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 15.0
          },
          "required": true,
          "type": "trabalho"
        },
        {
          "name": "B",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": true,
          "type": "trabalho"
        },
        {
          "name": "L",
          "orientation": "s",
          "position": {
            "x": 10.0,
            "y": -15.0
          },
          "required": true,
          "type": "dreno"
        },
        {
          "name": "X",
          "orientation": "w",
          "position": {
            "x": -15.0,
            "y": 0.0
          },
          "required": true,
          "type": "piloto"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": -46.0,
            "y": 23.0
          },
          "prefixo": "V",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "valvula",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -30.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 30.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 30.0,
              "y": 20.0
            },
            {
              "bulge": 0,
              "x": -30.0,
              "y": 20.0
            }
          ]
        },
        {
          "end": {
            "x": -10.0,
            "y": 20.0
          },
          "start": {
            "x": -10.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 10.0,
            "y": 20.0
          },
          "start": {
            "x": 10.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -5.0,
            "y": 4.0
          },
          "start": {
            "x": -5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -3.0,
            "y": 4.0
          },
          "start": {
            "x": -7.0,
            "y": 4.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -5.0,
            "y": 16.0
          },
          "start": {
            "x": -5.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -3.0,
            "y": 16.0
          },
          "start": {
            "x": -7.0,
            "y": 16.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": 4.0
          },
          "start": {
            "x": 5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 7.0,
            "y": 4.0
          },
          "start": {
            "x": 3.0,
            "y": 4.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": 16.0
          },
          "start": {
            "x": 5.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 7.0,
            "y": 16.0
          },
          "start": {
            "x": 3.0,
            "y": 16.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -25.0,
            "y": 17.0
          },
          "start": {
            "x": -25.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -25.0,
                  "y": 20.0
                },
                {
                  "bulge": 0,
                  "x": -26.2,
                  "y": 17.0
                },
                {
                  "bulge": 0,
                  "x": -23.8,
                  "y": 17.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": -15.0,
            "y": 3.0
          },
          "start": {
            "x": -15.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -15.0,
                  "y": 0.0
                },
                {
                  "bulge": 0,
                  "x": -13.8,
                  "y": 3.0
                },
                {
                  "bulge": 0,
                  "x": -16.2,
                  "y": 3.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 23.66,
            "y": 17.32
          },
          "start": {
            "x": 15.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 25.0,
                  "y": 20.0
                },
                {
                  "bulge": 0,
                  "x": 22.59,
                  "y": 17.85
                },
                {
                  "bulge": 0,
                  "x": 24.73,
                  "y": 16.78
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 23.66,
            "y": 2.68
          },
          "start": {
            "x": 15.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 25.0,
                  "y": 0.0
                },
                {
                  "bulge": 0,
                  "x": 24.73,
                  "y": 3.22
                },
                {
                  "bulge": 0,
                  "x": 22.59,
                  "y": 2.15
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": -5.0,
            "y": -5.0
          },
          "start": {
            "x": -5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": -5.0
          },
          "start": {
            "x": 5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -5.0,
            "y": 25.0
          },
          "start": {
            "x": -5.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": 25.0
          },
          "start": {
            "x": 5.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 30.0,
            "y": 22.0
          },
          "start": {
            "x": -30.0,
            "y": 22.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 30.0,
            "y": -2.0
          },
          "start": {
            "x": -30.0,
            "y": -2.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 20.0,
            "y": -5.0
          },
          "lineType": "DASHED",
          "start": {
            "x": 20.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "closed": false,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -38.0,
              "y": 10.0
            },
            {
              "bulge": 0,
              "x": -37.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": -36.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": -35.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": -34.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": -33.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": -32.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": -31.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": -30.0,
              "y": 10.0
            }
          ]
        },
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -46.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": -38.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": -38.0,
              "y": 15.0
            },
            {
              "bulge": 0,
              "x": -46.0,
              "y": 15.0
            }
          ]
        },
        {
          "end": {
            "x": -38.0,
            "y": 15.0
          },
          "start": {
            "x": -46.0,
            "y": 5.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -37.63,
            "y": 15.1
          },
          "start": {
            "x": -48.0,
            "y": 3.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -36.0,
                  "y": 17.0
                },
                {
                  "bulge": 0,
                  "x": -38.39,
                  "y": 15.75
                },
                {
                  "bulge": 0,
                  "x": -36.87,
                  "y": 14.45
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "closed": false,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 30.0,
              "y": 10.0
            },
            {
              "bulge": 0,
              "x": 31.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 32.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": 33.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 34.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": 35.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 36.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": 37.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 38.0,
              "y": 10.0
            }
          ]
        },
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 38.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": 46.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": 46.0,
              "y": 15.0
            },
            {
              "bulge": 0,
              "x": 38.0,
              "y": 15.0
            }
          ]
        },
        {
          "end": {
            "x": 46.0,
            "y": 15.0
          },
          "start": {
            "x": 38.0,
            "y": 5.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 46.37,
            "y": 15.1
          },
          "start": {
            "x": 36.0,
            "y": 3.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 48.0,
                  "y": 17.0
                },
                {
                  "bulge": 0,
                  "x": 45.61,
                  "y": 15.75
                },
                {
                  "bulge": 0,
                  "x": 47.13,
                  "y": 14.45
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        }
      ],
      "id": "valvula-4-3-proporcional-ls",
      "nome": "Válvula direcional proporcional 4/3, centro fechado, comando eletro-hidráulico e sinal LS",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "P",
          "orientation": "s",
          "position": {
            "x": -5.0,
            "y": -5.0
          },
          "required": true,
          "type": "pressao"
        },
        {
          "name": "T",
          "orientation": "s",
          "position": {
            "x": 5.0,
            "y": -5.0
          },
          "required": true,
          "type": "retorno"
        },
        {
          "name": "A",
          "orientation": "n",
          "position": {
            "x": -5.0,
            "y": 25.0
          },
          "required": true,
          "type": "trabalho"
        },
        {
          "name": "B",
          "orientation": "n",
          "position": {
            "x": 5.0,
            "y": 25.0
          },
          "required": true,
          "type": "trabalho"
        },
        {
          "name": "LS",
          "orientation": "s",
          "position": {
            "x": 20.0,
            "y": -5.0
          },
          "required": false,
          "type": "piloto"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": -46.0,
            "y": 23.0
          },
          "prefixo": "V",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "valvula",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -30.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 30.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 30.0,
              "y": 20.0
            },
            {
              "bulge": 0,
              "x": -30.0,
              "y": 20.0
            }
          ]
        },
        {
          "end": {
            "x": -10.0,
            "y": 20.0
          },
          "start": {
            "x": -10.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 10.0,
            "y": 20.0
          },
          "start": {
            "x": 10.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -5.0,
            "y": 4.0
          },
          "start": {
            "x": -5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -3.0,
            "y": 4.0
          },
          "start": {
            "x": -7.0,
            "y": 4.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -5.0,
            "y": 16.0
          },
          "start": {
            "x": -5.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -3.0,
            "y": 16.0
          },
          "start": {
            "x": -7.0,
            "y": 16.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": 4.0
          },
          "start": {
            "x": 5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 7.0,
            "y": 4.0
          },
          "start": {
            "x": 3.0,
            "y": 4.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": 16.0
          },
          "start": {
            "x": 5.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 7.0,
            "y": 16.0
          },
          "start": {
            "x": 3.0,
            "y": 16.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -25.0,
            "y": 17.0
          },
          "start": {
            "x": -25.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -25.0,
                  "y": 20.0
                },
                {
                  "bulge": 0,
                  "x": -26.2,
                  "y": 17.0
                },
                {
                  "bulge": 0,
                  "x": -23.8,
                  "y": 17.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": -15.0,
            "y": 3.0
          },
          "start": {
            "x": -15.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -15.0,
                  "y": 0.0
                },
                {
                  "bulge": 0,
                  "x": -13.8,
                  "y": 3.0
                },
                {
                  "bulge": 0,
                  "x": -16.2,
                  "y": 3.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 23.66,
            "y": 17.32
          },
          "start": {
            "x": 15.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 25.0,
                  "y": 20.0
                },
                {
                  "bulge": 0,
                  "x": 22.59,
                  "y": 17.85
                },
                {
                  "bulge": 0,
                  "x": 24.73,
                  "y": 16.78
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 23.66,
            "y": 2.68
          },
          "start": {
            "x": 15.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 25.0,
                  "y": 0.0
                },
                {
                  "bulge": 0,
                  "x": 24.73,
                  "y": 3.22
                },
                {
                  "bulge": 0,
                  "x": 22.59,
                  "y": 2.15
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": -5.0,
            "y": -5.0
          },
          "start": {
            "x": -5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": -5.0
          },
          "start": {
            "x": 5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -5.0,
            "y": 25.0
          },
          "start": {
            "x": -5.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": 25.0
          },
          "start": {
            "x": 5.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 20.0,
            "y": -5.0
          },
          "lineType": "DASHED",
          "start": {
            "x": 20.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "closed": false,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -38.0,
              "y": 10.0
            },
            {
              "bulge": 0,
              "x": -37.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": -36.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": -35.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": -34.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": -33.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": -32.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": -31.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": -30.0,
              "y": 10.0
            }
          ]
        },
        {
          "end": {
            "x": -44.0,
            "y": 10.0
          },
          "start": {
            "x": -38.0,
            "y": 10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -48.0,
            "y": 16.0
          },
          "start": {
            "x": -44.0,
            "y": 10.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": -48.0,
            "y": 17.0
          },
          "radius": 1.0,
          "type": "circle"
        },
        {
          "closed": false,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 30.0,
              "y": 10.0
            },
            {
              "bulge": 0,
              "x": 31.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 32.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": 33.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 34.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": 35.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 36.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": 37.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 38.0,
              "y": 10.0
            }
          ]
        }
      ],
      "id": "valvula-4-3-alavanca-ls",
      "nome": "Válvula direcional 4/3, centro fechado, alavanca manual, centrada por molas, com sinal LS",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "P",
          "orientation": "s",
          "position": {
            "x": -5.0,
            "y": -5.0
          },
          "required": true,
          "type": "pressao"
        },
        {
          "name": "T",
          "orientation": "s",
          "position": {
            "x": 5.0,
            "y": -5.0
          },
          "required": true,
          "type": "retorno"
        },
        {
          "name": "A",
          "orientation": "n",
          "position": {
            "x": -5.0,
            "y": 25.0
          },
          "required": true,
          "type": "trabalho"
        },
        {
          "name": "B",
          "orientation": "n",
          "position": {
            "x": 5.0,
            "y": 25.0
          },
          "required": true,
          "type": "trabalho"
        },
        {
          "name": "LS",
          "orientation": "s",
          "position": {
            "x": 20.0,
            "y": -5.0
          },
          "required": false,
          "type": "piloto"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": -28.0,
            "y": 23.0
          },
          "prefixo": "V",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "valvula",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -20.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 20.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 20.0,
              "y": 20.0
            },
            {
              "bulge": 0,
              "x": -20.0,
              "y": 20.0
            }
          ]
        },
        {
          "end": {
            "x": 0.0,
            "y": 20.0
          },
          "start": {
            "x": 0.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -10.0,
            "y": 17.0
          },
          "start": {
            "x": -10.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -10.0,
                  "y": 20.0
                },
                {
                  "bulge": 0,
                  "x": -11.2,
                  "y": 17.0
                },
                {
                  "bulge": 0,
                  "x": -8.8,
                  "y": 17.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 10.0,
            "y": 4.0
          },
          "start": {
            "x": 10.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 12.0,
            "y": 4.0
          },
          "start": {
            "x": 8.0,
            "y": 4.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 10.0,
            "y": 16.0
          },
          "start": {
            "x": 10.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 12.0,
            "y": 16.0
          },
          "start": {
            "x": 8.0,
            "y": 16.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 10.0,
            "y": -5.0
          },
          "start": {
            "x": 10.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 10.0,
            "y": 25.0
          },
          "start": {
            "x": 10.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -28.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": -20.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": -20.0,
              "y": 15.0
            },
            {
              "bulge": 0,
              "x": -28.0,
              "y": 15.0
            }
          ]
        },
        {
          "end": {
            "x": -20.0,
            "y": 15.0
          },
          "start": {
            "x": -28.0,
            "y": 5.0
          },
          "type": "line"
        },
        {
          "closed": false,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 20.0,
              "y": 10.0
            },
            {
              "bulge": 0,
              "x": 21.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 22.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": 23.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 24.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": 25.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 26.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": 27.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 28.0,
              "y": 10.0
            }
          ]
        }
      ],
      "id": "valvula-2-2-solenoide-nf",
      "nome": "Válvula direcional 2/2 normalmente fechada, solenoide e mola",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "A",
          "orientation": "s",
          "position": {
            "x": 10.0,
            "y": -5.0
          },
          "required": true,
          "type": "passante"
        },
        {
          "name": "B",
          "orientation": "n",
          "position": {
            "x": 10.0,
            "y": 25.0
          },
          "required": true,
          "type": "passante"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": -28.0,
            "y": 23.0
          },
          "prefixo": "V",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "valvula",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -20.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 20.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 20.0,
              "y": 20.0
            },
            {
              "bulge": 0,
              "x": -20.0,
              "y": 20.0
            }
          ]
        },
        {
          "end": {
            "x": 0.0,
            "y": 20.0
          },
          "start": {
            "x": 0.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 14.27,
            "y": 2.91
          },
          "start": {
            "x": 10.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 15.0,
                  "y": 0.0
                },
                {
                  "bulge": 0,
                  "x": 15.44,
                  "y": 3.2
                },
                {
                  "bulge": 0,
                  "x": 13.11,
                  "y": 2.62
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 5.0,
            "y": 4.0
          },
          "start": {
            "x": 5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 7.0,
            "y": 4.0
          },
          "start": {
            "x": 3.0,
            "y": 4.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -10.73,
            "y": 17.09
          },
          "start": {
            "x": -15.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -10.0,
                  "y": 20.0
                },
                {
                  "bulge": 0,
                  "x": -11.89,
                  "y": 17.38
                },
                {
                  "bulge": 0,
                  "x": -9.56,
                  "y": 16.8
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": -5.0,
            "y": 4.0
          },
          "start": {
            "x": -5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -3.0,
            "y": 4.0
          },
          "start": {
            "x": -7.0,
            "y": 4.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": -5.0
          },
          "start": {
            "x": 5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 15.0,
            "y": -5.0
          },
          "start": {
            "x": 15.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 10.0,
            "y": 25.0
          },
          "start": {
            "x": 10.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -28.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": -20.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": -20.0,
              "y": 15.0
            },
            {
              "bulge": 0,
              "x": -28.0,
              "y": 15.0
            }
          ]
        },
        {
          "end": {
            "x": -20.0,
            "y": 15.0
          },
          "start": {
            "x": -28.0,
            "y": 5.0
          },
          "type": "line"
        },
        {
          "closed": false,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 20.0,
              "y": 10.0
            },
            {
              "bulge": 0,
              "x": 21.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 22.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": 23.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 24.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": 25.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 26.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": 27.0,
              "y": 12.5
            },
            {
              "bulge": 0,
              "x": 28.0,
              "y": 10.0
            }
          ]
        }
      ],
      "id": "valvula-3-2-solenoide",
      "nome": "Válvula direcional 3/2, solenoide e mola, repouso com A para T",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "P",
          "orientation": "s",
          "position": {
            "x": 5.0,
            "y": -5.0
          },
          "required": true,
          "type": "pressao"
        },
        {
          "name": "T",
          "orientation": "s",
          "position": {
            "x": 15.0,
            "y": -5.0
          },
          "required": true,
          "type": "retorno"
        },
        {
          "name": "A",
          "orientation": "n",
          "position": {
            "x": 10.0,
            "y": 25.0
          },
          "required": true,
          "type": "piloto"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": -16.0,
            "y": 15.0
          },
          "prefixo": "V",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "valvula",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": -10.0,
            "y": -3.0
          },
          "start": {
            "x": -10.0,
            "y": -15.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -10.0,
            "y": 15.0
          },
          "start": {
            "x": -10.0,
            "y": 3.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -10.0,
            "y": -3.0
          },
          "start": {
            "x": -13.0,
            "y": 0.5
          },
          "type": "line"
        },
        {
          "end": {
            "x": -7.0,
            "y": 0.5
          },
          "start": {
            "x": -10.0,
            "y": -3.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": -10.0,
            "y": 0.0
          },
          "radius": 2.0,
          "type": "circle"
        },
        {
          "end": {
            "x": -10.0,
            "y": -2.0
          },
          "start": {
            "x": -10.0,
            "y": -3.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 10.0,
            "y": -3.0
          },
          "start": {
            "x": 10.0,
            "y": -15.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 10.0,
            "y": 15.0
          },
          "start": {
            "x": 10.0,
            "y": 3.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 10.0,
            "y": -3.0
          },
          "start": {
            "x": 7.0,
            "y": 0.5
          },
          "type": "line"
        },
        {
          "end": {
            "x": 13.0,
            "y": 0.5
          },
          "start": {
            "x": 10.0,
            "y": -3.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 10.0,
            "y": 0.0
          },
          "radius": 2.0,
          "type": "circle"
        },
        {
          "end": {
            "x": 10.0,
            "y": -2.0
          },
          "start": {
            "x": 10.0,
            "y": -3.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 7.0,
            "y": 0.0
          },
          "lineType": "DASHED",
          "start": {
            "x": -10.0,
            "y": -8.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -7.0,
            "y": 0.0
          },
          "lineType": "DASHED",
          "start": {
            "x": 10.0,
            "y": -8.0
          },
          "type": "line"
        },
        {
          "closed": true,
          "lineType": "DASHED",
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -16.0,
              "y": -11.0
            },
            {
              "bulge": 0,
              "x": 16.0,
              "y": -11.0
            },
            {
              "bulge": 0,
              "x": 16.0,
              "y": 11.0
            },
            {
              "bulge": 0,
              "x": -16.0,
              "y": 11.0
            }
          ]
        }
      ],
      "id": "retencao-dupla-pilotada",
      "nome": "Válvula de retenção dupla pilotada (A1→B1 e A2→B2 livres; volta pilotada pela linha oposta)",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "A1",
          "orientation": "s",
          "position": {
            "x": -10.0,
            "y": -15.0
          },
          "required": true,
          "type": "passante"
        },
        {
          "name": "A2",
          "orientation": "s",
          "position": {
            "x": 10.0,
            "y": -15.0
          },
          "required": true,
          "type": "passante"
        },
        {
          "name": "B1",
          "orientation": "n",
          "position": {
            "x": -10.0,
            "y": 15.0
          },
          "required": true,
          "type": "passante"
        },
        {
          "name": "B2",
          "orientation": "n",
          "position": {
            "x": 10.0,
            "y": 15.0
          },
          "required": true,
          "type": "passante"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": 9.0,
            "y": 3.0
          },
          "prefixo": "F",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "condicionamento",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 0.0,
              "y": -7.0
            },
            {
              "bulge": 0,
              "x": 7.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 0.0,
              "y": 7.0
            },
            {
              "bulge": 0,
              "x": -7.0,
              "y": 0.0
            }
          ]
        },
        {
          "end": {
            "x": 7.0,
            "y": 0.0
          },
          "lineType": "DASHED",
          "start": {
            "x": -7.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": -7.0
          },
          "start": {
            "x": 0.0,
            "y": -10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": 10.0
          },
          "start": {
            "x": 0.0,
            "y": 7.0
          },
          "type": "line"
        }
      ],
      "id": "filtro",
      "nome": "Filtro",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "A",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -10.0
          },
          "required": true,
          "type": "passante"
        },
        {
          "name": "B",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 10.0
          },
          "required": true,
          "type": "passante"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": 13.0,
            "y": 3.0
          },
          "prefixo": "E",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "condicionamento",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 0.0,
              "y": -7.0
            },
            {
              "bulge": 0,
              "x": 7.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 0.0,
              "y": 7.0
            },
            {
              "bulge": 0,
              "x": -7.0,
              "y": 0.0
            }
          ]
        },
        {
          "end": {
            "x": 0.0,
            "y": 10.0
          },
          "start": {
            "x": 0.0,
            "y": -10.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 12.0,
                  "y": 0.0
                },
                {
                  "bulge": 0,
                  "x": 9.0,
                  "y": 2.0
                },
                {
                  "bulge": 0,
                  "x": 9.0,
                  "y": -2.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": 9.0,
            "y": 0.0
          },
          "start": {
            "x": 7.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": -12.0,
                  "y": 0.0
                },
                {
                  "bulge": 0,
                  "x": -9.0,
                  "y": 2.0
                },
                {
                  "bulge": 0,
                  "x": -9.0,
                  "y": -2.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": -9.0,
            "y": 0.0
          },
          "start": {
            "x": -7.0,
            "y": 0.0
          },
          "type": "line"
        }
      ],
      "id": "resfriador",
      "nome": "Resfriador (trocador de calor) de óleo",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "A",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -10.0
          },
          "required": true,
          "type": "passante"
        },
        {
          "name": "B",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 10.0
          },
          "required": true,
          "type": "passante"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": -16.0,
            "y": 23.0
          },
          "prefixo": "D",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "valvula",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -15.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 15.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": 15.0,
              "y": 20.0
            },
            {
              "bulge": 0,
              "x": -15.0,
              "y": 20.0
            }
          ]
        },
        {
          "center": {
            "x": 0.0,
            "y": 10.0
          },
          "radius": 5.0,
          "type": "circle"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 0.0,
                  "y": 15.0
                },
                {
                  "bulge": 0,
                  "x": -1.8,
                  "y": 12.0
                },
                {
                  "bulge": 0,
                  "x": 1.8,
                  "y": 12.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 0.0,
                  "y": 5.0
                },
                {
                  "bulge": 0,
                  "x": -1.8,
                  "y": 8.0
                },
                {
                  "bulge": 0,
                  "x": 1.8,
                  "y": 8.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": -21.0,
            "y": 10.0
          },
          "start": {
            "x": -15.0,
            "y": 10.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": -24.0,
            "y": 10.0
          },
          "radius": 3.0,
          "type": "circle"
        },
        {
          "end": {
            "x": -5.0,
            "y": -5.0
          },
          "start": {
            "x": -5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": -5.0
          },
          "start": {
            "x": 5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -5.0,
            "y": 25.0
          },
          "start": {
            "x": -5.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": 25.0
          },
          "start": {
            "x": 5.0,
            "y": 20.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 20.0,
            "y": 3.0
          },
          "lineType": "DASHED",
          "start": {
            "x": 15.0,
            "y": 3.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 20.0,
            "y": -5.0
          },
          "lineType": "DASHED",
          "start": {
            "x": 20.0,
            "y": 3.0
          },
          "type": "line"
        }
      ],
      "id": "unidade-direcao-ls",
      "nome": "Unidade de direção hidrostática com volante e sinal LS",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "P",
          "orientation": "s",
          "position": {
            "x": -5.0,
            "y": -5.0
          },
          "required": true,
          "type": "pressao"
        },
        {
          "name": "T",
          "orientation": "s",
          "position": {
            "x": 5.0,
            "y": -5.0
          },
          "required": true,
          "type": "retorno"
        },
        {
          "name": "L",
          "orientation": "n",
          "position": {
            "x": -5.0,
            "y": 25.0
          },
          "required": true,
          "type": "trabalho"
        },
        {
          "name": "R",
          "orientation": "n",
          "position": {
            "x": 5.0,
            "y": 25.0
          },
          "required": true,
          "type": "trabalho"
        },
        {
          "name": "LS",
          "orientation": "s",
          "position": {
            "x": 20.0,
            "y": -5.0
          },
          "required": false,
          "type": "piloto"
        }
      ],
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": -14.0,
            "y": 8.0
          },
          "prefixo": "V",
          "visivel": true
        },
        {
          "nome": "descricao",
          "visivel": false
        },
        {
          "nome": "codigo",
          "visivel": false
        }
      ],
      "categoria": "valvula",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -5.0,
              "y": -5.0
            },
            {
              "bulge": 0,
              "x": 5.0,
              "y": -5.0
            },
            {
              "bulge": 0,
              "x": 5.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": -5.0,
              "y": 5.0
            }
          ]
        },
        {
          "end": {
            "x": 1.5,
            "y": -2.5
          },
          "start": {
            "x": -4.0,
            "y": -2.5
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 4.0,
                  "y": -2.5
                },
                {
                  "bulge": 0,
                  "x": 1.5,
                  "y": -1.5
                },
                {
                  "bulge": 0,
                  "x": 1.5,
                  "y": -3.5
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "end": {
            "x": -5.0,
            "y": 0.0
          },
          "start": {
            "x": -15.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 15.0,
            "y": 0.0
          },
          "start": {
            "x": 5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "closed": false,
          "lineType": "DASHED",
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -10.0,
              "y": 0.0
            },
            {
              "bulge": 0,
              "x": -10.0,
              "y": -8.0
            },
            {
              "bulge": 0,
              "x": -2.0,
              "y": -8.0
            },
            {
              "bulge": 0,
              "x": -2.0,
              "y": -5.0
            }
          ]
        },
        {
          "closed": false,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 0.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": -2.0,
              "y": 6.0
            },
            {
              "bulge": 0,
              "x": 2.0,
              "y": 7.5
            },
            {
              "bulge": 0,
              "x": -2.0,
              "y": 9.0
            },
            {
              "bulge": 0,
              "x": 2.0,
              "y": 10.5
            },
            {
              "bulge": 0,
              "x": 0.0,
              "y": 11.5
            }
          ]
        }
      ],
      "id": "valvula-alivio",
      "nome": "Válvula limitadora de pressão (alívio), regulável",
      "norma": "ISO 1219-1",
      "portas": [
        {
          "name": "P",
          "orientation": "w",
          "position": {
            "x": -15.0,
            "y": 0.0
          },
          "required": true,
          "type": "pressao"
        },
        {
          "name": "T",
          "orientation": "e",
          "position": {
            "x": 15.0,
            "y": 0.0
          },
          "required": true,
          "type": "retorno"
        }
      ],
      "unidade": "mm",
      "versao": 1
    }
  ]
};
