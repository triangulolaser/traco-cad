// Biblioteca IEC 60617 genérica (elétrica) embutida no Traço (formato traco-simbolo v1).
// Gerada a partir dos arquivos JSON da biblioteca; as portas usam as chaves do terminal.
// Não editar à mão: refazer pelo gerador da biblioteca e converter de novo.

export default {
  "manifesto": {
    "formato": "traco-biblioteca",
    "id": "iec60617",
    "nome": "IEC 60617 genérica (elétrica)",
    "simbolos": [
      "fusivel.json",
      "fusivel-seccionador.json",
      "rele-4-vias.json",
      "chave-2-posicoes.json",
      "chave-3-posicoes.json",
      "botao.json",
      "emergencia.json",
      "ignicao.json",
      "lampada.json",
      "tomada-12v.json",
      "alimentacao-24v.json",
      "alimentacao-12v.json",
      "terra.json",
      "borne.json",
      "splice.json",
      "conector-2-femea.json",
      "conector-4-femea.json",
      "conector-12-macho.json",
      "conector-12-femea.json"
    ],
    "versao": 1,
    "versao_biblioteca": "0.1.1"
  },
  "simbolos": [
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": 5.0,
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
      "categoria": "protecao",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": 0.0,
            "y": 15.0
          },
          "start": {
            "x": 0.0,
            "y": -15.0
          },
          "type": "line"
        },
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -2.0,
              "y": -6.0
            },
            {
              "bulge": 0,
              "x": 2.0,
              "y": -6.0
            },
            {
              "bulge": 0,
              "x": 2.0,
              "y": 6.0
            },
            {
              "bulge": 0,
              "x": -2.0,
              "y": 6.0
            }
          ]
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": 11.8
          },
          "rotation": 0,
          "text": "1",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -13.8
          },
          "rotation": 0,
          "text": "2",
          "type": "text"
        }
      ],
      "id": "fusivel",
      "nome": "Fusível",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "1",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 15.0
          },
          "required": true,
          "type": "eletrico"
        },
        {
          "name": "2",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": true,
          "type": "eletrico"
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
            "x": 5.0,
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
      "categoria": "protecao",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": 0.0,
            "y": -6.0
          },
          "start": {
            "x": 0.0,
            "y": -15.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -5.0,
            "y": 6.0
          },
          "start": {
            "x": 0.0,
            "y": -6.0
          },
          "type": "line"
        },
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -2.35,
              "y": -4.27
            },
            {
              "bulge": 0,
              "x": -5.42,
              "y": 3.12
            },
            {
              "bulge": 0,
              "x": -2.65,
              "y": 4.27
            },
            {
              "bulge": 0,
              "x": 0.42,
              "y": -3.12
            }
          ]
        },
        {
          "end": {
            "x": 0.0,
            "y": 6.0
          },
          "start": {
            "x": 0.0,
            "y": 15.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 1.5,
            "y": 6.0
          },
          "start": {
            "x": -1.5,
            "y": 6.0
          },
          "type": "line"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": 11.8
          },
          "rotation": 0,
          "text": "1",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -13.8
          },
          "rotation": 0,
          "text": "2",
          "type": "text"
        }
      ],
      "id": "fusivel-seccionador",
      "nome": "Fusível-seccionador (porta-fusível com abertura)",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "1",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 15.0
          },
          "required": true,
          "type": "eletrico"
        },
        {
          "name": "2",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": true,
          "type": "eletrico"
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
            "y": 18.0
          },
          "prefixo": "K",
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
      "categoria": "rele",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": -10.0,
            "y": 5.0
          },
          "start": {
            "x": -10.0,
            "y": 15.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -10.0,
            "y": -5.0
          },
          "start": {
            "x": -10.0,
            "y": -15.0
          },
          "type": "line"
        },
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -14.0,
              "y": -5.0
            },
            {
              "bulge": 0,
              "x": -6.0,
              "y": -5.0
            },
            {
              "bulge": 0,
              "x": -6.0,
              "y": 5.0
            },
            {
              "bulge": 0,
              "x": -14.0,
              "y": 5.0
            }
          ]
        },
        {
          "end": {
            "x": 10.0,
            "y": -5.0
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
            "y": 5.0
          },
          "start": {
            "x": 10.0,
            "y": 15.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": 5.0
          },
          "start": {
            "x": 10.0,
            "y": -5.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 7.5,
            "y": 0.0
          },
          "lineType": "DASHED",
          "start": {
            "x": -6.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "height": 2.0,
          "position": {
            "x": -9.2,
            "y": 11.8
          },
          "rotation": 0,
          "text": "85",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": -9.2,
            "y": -13.8
          },
          "rotation": 0,
          "text": "86",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 10.8,
            "y": 11.8
          },
          "rotation": 0,
          "text": "87",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 10.8,
            "y": -13.8
          },
          "rotation": 0,
          "text": "30",
          "type": "text"
        }
      ],
      "id": "rele-4-vias",
      "nome": "Relé de 4 vias (bobina 85-86, contato NA 30-87)",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "85",
          "orientation": "n",
          "position": {
            "x": -10.0,
            "y": 15.0
          },
          "required": true,
          "type": "eletrico"
        },
        {
          "name": "86",
          "orientation": "s",
          "position": {
            "x": -10.0,
            "y": -15.0
          },
          "required": true,
          "type": "eletrico"
        },
        {
          "name": "87",
          "orientation": "n",
          "position": {
            "x": 10.0,
            "y": 15.0
          },
          "required": true,
          "type": "eletrico"
        },
        {
          "name": "30",
          "orientation": "s",
          "position": {
            "x": 10.0,
            "y": -15.0
          },
          "required": true,
          "type": "eletrico"
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
            "x": 4.0,
            "y": 3.0
          },
          "prefixo": "S",
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
      "categoria": "chave",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": 0.0,
            "y": -5.0
          },
          "start": {
            "x": 0.0,
            "y": -15.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": 5.0
          },
          "start": {
            "x": 0.0,
            "y": 15.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -5.0,
            "y": 5.0
          },
          "start": {
            "x": 0.0,
            "y": -5.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -10.0,
            "y": 0.0
          },
          "lineType": "DASHED",
          "start": {
            "x": -2.5,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -10.0,
            "y": 3.0
          },
          "start": {
            "x": -10.0,
            "y": -3.0
          },
          "type": "line"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": 11.8
          },
          "rotation": 0,
          "text": "2",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -13.8
          },
          "rotation": 0,
          "text": "1",
          "type": "text"
        }
      ],
      "id": "chave-2-posicoes",
      "nome": "Chave de 2 posições (liga-desliga), acionamento manual",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "2",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 15.0
          },
          "required": true,
          "type": "eletrico"
        },
        {
          "name": "1",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": true,
          "type": "eletrico"
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
            "y": 0.0
          },
          "prefixo": "S",
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
      "categoria": "chave",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": 0.0,
            "y": -5.0
          },
          "start": {
            "x": 0.0,
            "y": -15.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": 5.0
          },
          "start": {
            "x": 0.0,
            "y": -5.0
          },
          "type": "line"
        },
        {
          "closed": false,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -10.0,
              "y": 15.0
            },
            {
              "bulge": 0,
              "x": -10.0,
              "y": 7.0
            },
            {
              "bulge": 0,
              "x": -3.0,
              "y": 7.0
            }
          ]
        },
        {
          "closed": false,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 10.0,
              "y": 15.0
            },
            {
              "bulge": 0,
              "x": 10.0,
              "y": 7.0
            },
            {
              "bulge": 0,
              "x": 3.0,
              "y": 7.0
            }
          ]
        },
        {
          "end": {
            "x": -12.0,
            "y": 0.0
          },
          "lineType": "DASHED",
          "start": {
            "x": 0.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -12.0,
            "y": 3.0
          },
          "start": {
            "x": -12.0,
            "y": -3.0
          },
          "type": "line"
        },
        {
          "height": 2.0,
          "position": {
            "x": -9.2,
            "y": 11.8
          },
          "rotation": 0,
          "text": "1",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 10.8,
            "y": 11.8
          },
          "rotation": 0,
          "text": "3",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -13.8
          },
          "rotation": 0,
          "text": "2",
          "type": "text"
        }
      ],
      "id": "chave-3-posicoes",
      "nome": "Chave de 3 posições com retorno ao centro ((liga)-desliga-(liga)), comum no 2",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "1",
          "orientation": "n",
          "position": {
            "x": -10.0,
            "y": 15.0
          },
          "required": true,
          "type": "eletrico"
        },
        {
          "name": "3",
          "orientation": "n",
          "position": {
            "x": 10.0,
            "y": 15.0
          },
          "required": true,
          "type": "eletrico"
        },
        {
          "name": "2",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": true,
          "type": "eletrico"
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
            "x": 4.0,
            "y": 3.0
          },
          "prefixo": "S",
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
      "categoria": "chave",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": 0.0,
            "y": -5.0
          },
          "start": {
            "x": 0.0,
            "y": -15.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": 5.0
          },
          "start": {
            "x": 0.0,
            "y": 15.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -5.0,
            "y": 5.0
          },
          "start": {
            "x": 0.0,
            "y": -5.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -10.0,
            "y": 0.0
          },
          "lineType": "DASHED",
          "start": {
            "x": -2.5,
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
              "x": -8.5,
              "y": 3.0
            },
            {
              "bulge": 0,
              "x": -10.0,
              "y": 3.0
            },
            {
              "bulge": 0,
              "x": -10.0,
              "y": -3.0
            },
            {
              "bulge": 0,
              "x": -8.5,
              "y": -3.0
            }
          ]
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": 11.8
          },
          "rotation": 0,
          "text": "2",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -13.8
          },
          "rotation": 0,
          "text": "1",
          "type": "text"
        }
      ],
      "id": "botao",
      "nome": "Botão momentâneo NA",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "2",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 15.0
          },
          "required": true,
          "type": "eletrico"
        },
        {
          "name": "1",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": true,
          "type": "eletrico"
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
            "x": 6.0,
            "y": 3.0
          },
          "prefixo": "S",
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
      "categoria": "chave",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": 0.0,
            "y": -5.0
          },
          "start": {
            "x": 0.0,
            "y": -15.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": 5.0
          },
          "start": {
            "x": 0.0,
            "y": 15.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 4.0,
            "y": 5.0
          },
          "start": {
            "x": 0.0,
            "y": 5.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": 6.5
          },
          "start": {
            "x": 0.0,
            "y": -5.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -10.0,
            "y": 0.75
          },
          "lineType": "DASHED",
          "start": {
            "x": 2.5,
            "y": 0.75
          },
          "type": "line"
        },
        {
          "end": {
            "x": -10.0,
            "y": 3.75
          },
          "start": {
            "x": -10.0,
            "y": -2.25
          },
          "type": "line"
        },
        {
          "center": {
            "x": -10.0,
            "y": 0.75
          },
          "end": 4.712389,
          "radius": 3.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": 11.8
          },
          "rotation": 0,
          "text": "2",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -13.8
          },
          "rotation": 0,
          "text": "1",
          "type": "text"
        }
      ],
      "id": "emergencia",
      "nome": "Botão de emergência (cogumelo), contato NF",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "2",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 15.0
          },
          "required": true,
          "type": "eletrico"
        },
        {
          "name": "1",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": true,
          "type": "eletrico"
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
            "x": -20.0,
            "y": 13.0
          },
          "prefixo": "S",
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
      "categoria": "chave",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "closed": true,
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": -20.0,
              "y": -10.0
            },
            {
              "bulge": 0,
              "x": 20.0,
              "y": -10.0
            },
            {
              "bulge": 0,
              "x": 20.0,
              "y": 10.0
            },
            {
              "bulge": 0,
              "x": -20.0,
              "y": 10.0
            }
          ]
        },
        {
          "end": {
            "x": -15.0,
            "y": -15.0
          },
          "start": {
            "x": -15.0,
            "y": -10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -5.0,
            "y": -15.0
          },
          "start": {
            "x": -5.0,
            "y": -10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": -15.0
          },
          "start": {
            "x": 5.0,
            "y": -10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 15.0,
            "y": -15.0
          },
          "start": {
            "x": 15.0,
            "y": -10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -27.0,
            "y": 0.0
          },
          "start": {
            "x": -20.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": -29.0,
            "y": 0.0
          },
          "radius": 2.0,
          "type": "circle"
        },
        {
          "end": {
            "x": -24.0,
            "y": -2.0
          },
          "start": {
            "x": -24.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": -22.0,
            "y": -2.0
          },
          "start": {
            "x": -22.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "height": 2.0,
          "position": {
            "x": -14.2,
            "y": -13.8
          },
          "rotation": 0,
          "text": "1",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": -4.2,
            "y": -13.8
          },
          "rotation": 0,
          "text": "2",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 5.8,
            "y": -13.8
          },
          "rotation": 0,
          "text": "3",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 15.8,
            "y": -13.8
          },
          "rotation": 0,
          "text": "4",
          "type": "text"
        }
      ],
      "id": "ignicao",
      "nome": "Chave de ignição de 4 terminais, acionada por chave",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "1",
          "orientation": "s",
          "position": {
            "x": -15.0,
            "y": -15.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "2",
          "orientation": "s",
          "position": {
            "x": -5.0,
            "y": -15.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "3",
          "orientation": "s",
          "position": {
            "x": 5.0,
            "y": -15.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "4",
          "orientation": "s",
          "position": {
            "x": 15.0,
            "y": -15.0
          },
          "required": false,
          "type": "eletrico"
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
            "x": 7.0,
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
      "categoria": "carga",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "center": {
            "x": 0.0,
            "y": 0.0
          },
          "radius": 5.0,
          "type": "circle"
        },
        {
          "end": {
            "x": 3.54,
            "y": 3.54
          },
          "start": {
            "x": -3.54,
            "y": -3.54
          },
          "type": "line"
        },
        {
          "end": {
            "x": 3.54,
            "y": -3.54
          },
          "start": {
            "x": -3.54,
            "y": 3.54
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": 5.0
          },
          "start": {
            "x": 0.0,
            "y": 15.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": -5.0
          },
          "start": {
            "x": 0.0,
            "y": -15.0
          },
          "type": "line"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": 11.8
          },
          "rotation": 0,
          "text": "A1",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -13.8
          },
          "rotation": 0,
          "text": "A2",
          "type": "text"
        }
      ],
      "id": "lampada",
      "nome": "Lâmpada (sinalização ou farol)",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "A1",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 15.0
          },
          "required": true,
          "type": "eletrico"
        },
        {
          "name": "A2",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": true,
          "type": "eletrico"
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
            "x": 10.0,
            "y": 3.0
          },
          "prefixo": "X",
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
      "categoria": "conector",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "center": {
            "x": 0.0,
            "y": 5.0
          },
          "end": 6.283185,
          "radius": 8.0,
          "start": 3.141593,
          "type": "arc"
        },
        {
          "end": {
            "x": -5.0,
            "y": -1.24
          },
          "start": {
            "x": -5.0,
            "y": -15.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": -1.24
          },
          "start": {
            "x": 5.0,
            "y": -15.0
          },
          "type": "line"
        },
        {
          "height": 2.0,
          "position": {
            "x": -4.2,
            "y": -13.8
          },
          "rotation": 0,
          "text": "+12 V",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 5.8,
            "y": -13.8
          },
          "rotation": 0,
          "text": "GND",
          "type": "text"
        }
      ],
      "id": "tomada-12v",
      "nome": "Tomada de 12 V, 2 vias",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "+12 V",
          "orientation": "s",
          "position": {
            "x": -5.0,
            "y": -15.0
          },
          "required": true,
          "type": "eletrico"
        },
        {
          "name": "GND",
          "orientation": "s",
          "position": {
            "x": 5.0,
            "y": -15.0
          },
          "required": true,
          "type": "eletrico"
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
            "x": 6.0,
            "y": 0.0
          },
          "prefixo": "V",
          "visivel": false
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
      "categoria": "alimentacao",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": 0.0,
            "y": 0.0
          },
          "start": {
            "x": 0.0,
            "y": -5.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 4.0,
            "y": 0.0
          },
          "start": {
            "x": -4.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": 1.0
          },
          "start": {
            "x": 0.0,
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
                  "x": 0.0,
                  "y": 4.0
                },
                {
                  "bulge": 0,
                  "x": -1.5,
                  "y": 1.0
                },
                {
                  "bulge": 0,
                  "x": 1.5,
                  "y": 1.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        }
      ],
      "id": "alimentacao-24v",
      "nome": "Alimentação +24 V (rede global)",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "+24V",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -5.0
          },
          "required": true,
          "type": "eletrico"
        }
      ],
      "rede_global": "+24V",
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": 6.0,
            "y": 0.0
          },
          "prefixo": "V",
          "visivel": false
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
      "categoria": "alimentacao",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": 0.0,
            "y": 0.0
          },
          "start": {
            "x": 0.0,
            "y": -5.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 4.0,
            "y": 0.0
          },
          "start": {
            "x": -4.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 0.0,
            "y": 1.0
          },
          "start": {
            "x": 0.0,
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
                  "x": 0.0,
                  "y": 4.0
                },
                {
                  "bulge": 0,
                  "x": -1.5,
                  "y": 1.0
                },
                {
                  "bulge": 0,
                  "x": 1.5,
                  "y": 1.0
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        }
      ],
      "id": "alimentacao-12v",
      "nome": "Alimentação +12 V (rede global)",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "+12V",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -5.0
          },
          "required": true,
          "type": "eletrico"
        }
      ],
      "rede_global": "+12V",
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": 6.0,
            "y": 0.0
          },
          "prefixo": "GND",
          "visivel": false
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
      "categoria": "alimentacao",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": 0.0,
            "y": 0.0
          },
          "start": {
            "x": 0.0,
            "y": 10.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 5.0,
            "y": 0.0
          },
          "start": {
            "x": -5.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "end": {
            "x": 3.5,
            "y": -1.5
          },
          "start": {
            "x": -3.5,
            "y": -1.5
          },
          "type": "line"
        },
        {
          "end": {
            "x": 2.0,
            "y": -3.0
          },
          "start": {
            "x": -2.0,
            "y": -3.0
          },
          "type": "line"
        }
      ],
      "id": "terra",
      "nome": "Terra / GND (rede global)",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "GND",
          "orientation": "n",
          "position": {
            "x": 0.0,
            "y": 10.0
          },
          "required": true,
          "type": "eletrico"
        }
      ],
      "rede_global": "GND",
      "unidade": "mm",
      "versao": 1
    },
    {
      "atributos": [
        {
          "altura": 2.5,
          "nome": "etiqueta",
          "posicao": {
            "x": 3.0,
            "y": 1.0
          },
          "prefixo": "X",
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
      "categoria": "ligacao",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": 0.0,
            "y": -1.5
          },
          "start": {
            "x": 0.0,
            "y": -5.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 0.0,
            "y": 0.0
          },
          "radius": 1.5,
          "type": "circle"
        }
      ],
      "id": "borne",
      "nome": "Borne (ponto de ligação; todos os fios na mesma porta)",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "1",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -5.0
          },
          "required": true,
          "type": "eletrico"
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
            "x": 3.0,
            "y": 1.0
          },
          "prefixo": "X",
          "visivel": false
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
      "categoria": "ligacao",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": 0.0,
            "y": 0.0
          },
          "start": {
            "x": 0.0,
            "y": -5.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 1.2,
                  "y": 0.0
                },
                {
                  "bulge": 0,
                  "x": 1.04,
                  "y": 0.6
                },
                {
                  "bulge": 0,
                  "x": 0.6,
                  "y": 1.04
                },
                {
                  "bulge": 0,
                  "x": 0.0,
                  "y": 1.2
                },
                {
                  "bulge": 0,
                  "x": -0.6,
                  "y": 1.04
                },
                {
                  "bulge": 0,
                  "x": -1.04,
                  "y": 0.6
                },
                {
                  "bulge": 0,
                  "x": -1.2,
                  "y": 0.0
                },
                {
                  "bulge": 0,
                  "x": -1.04,
                  "y": -0.6
                },
                {
                  "bulge": 0,
                  "x": -0.6,
                  "y": -1.04
                },
                {
                  "bulge": 0,
                  "x": -0.0,
                  "y": -1.2
                },
                {
                  "bulge": 0,
                  "x": 0.6,
                  "y": -1.04
                },
                {
                  "bulge": 0,
                  "x": 1.04,
                  "y": -0.6
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        }
      ],
      "id": "splice",
      "nome": "Emenda (splice) de fios; todos os fios na mesma porta",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "1",
          "orientation": "s",
          "position": {
            "x": 0.0,
            "y": -5.0
          },
          "required": true,
          "type": "eletrico"
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
            "x": 5.0,
            "y": 5.0
          },
          "prefixo": "X",
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
      "categoria": "conector",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": 10.0,
            "y": 0.0
          },
          "start": {
            "x": 0.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": 0.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "end": {
            "x": 10.0,
            "y": -5.0
          },
          "start": {
            "x": 0.0,
            "y": -5.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": -5.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "closed": true,
          "lineType": "DASHED",
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 5.0,
              "y": 3.0
            },
            {
              "bulge": 0,
              "x": 17.0,
              "y": 3.0
            },
            {
              "bulge": 0,
              "x": 17.0,
              "y": -8.0
            },
            {
              "bulge": 0,
              "x": 5.0,
              "y": -8.0
            }
          ]
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": 0.8
          },
          "rotation": 0,
          "text": "01",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -4.2
          },
          "rotation": 0,
          "text": "02",
          "type": "text"
        }
      ],
      "id": "conector-2-femea",
      "nome": "Conector de 2 vias, fêmea (soquetes)",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "01",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": 0.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "02",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -5.0
          },
          "required": false,
          "type": "eletrico"
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
            "x": 5.0,
            "y": 5.0
          },
          "prefixo": "X",
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
      "categoria": "conector",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": 10.0,
            "y": 0.0
          },
          "start": {
            "x": 0.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": 0.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "end": {
            "x": 10.0,
            "y": -5.0
          },
          "start": {
            "x": 0.0,
            "y": -5.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": -5.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "end": {
            "x": 10.0,
            "y": -10.0
          },
          "start": {
            "x": 0.0,
            "y": -10.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": -10.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "end": {
            "x": 10.0,
            "y": -15.0
          },
          "start": {
            "x": 0.0,
            "y": -15.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": -15.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "closed": true,
          "lineType": "DASHED",
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 5.0,
              "y": 3.0
            },
            {
              "bulge": 0,
              "x": 17.0,
              "y": 3.0
            },
            {
              "bulge": 0,
              "x": 17.0,
              "y": -18.0
            },
            {
              "bulge": 0,
              "x": 5.0,
              "y": -18.0
            }
          ]
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": 0.8
          },
          "rotation": 0,
          "text": "01",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -4.2
          },
          "rotation": 0,
          "text": "02",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -9.2
          },
          "rotation": 0,
          "text": "03",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -14.2
          },
          "rotation": 0,
          "text": "04",
          "type": "text"
        }
      ],
      "id": "conector-4-femea",
      "nome": "Conector de 4 vias, fêmea (soquetes)",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "01",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": 0.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "02",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -5.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "03",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -10.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "04",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": false,
          "type": "eletrico"
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
            "x": 5.0,
            "y": 5.0
          },
          "prefixo": "X",
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
      "categoria": "conector",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": 10.0,
            "y": 0.0
          },
          "start": {
            "x": 0.0,
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
                  "x": 10.0,
                  "y": -0.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -0.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": 0.8
                },
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": 0.8
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
            "y": -5.0
          },
          "start": {
            "x": 0.0,
            "y": -5.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -5.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -5.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -4.2
                },
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -4.2
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
            "y": -10.0
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
                  "x": 10.0,
                  "y": -10.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -10.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -9.2
                },
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -9.2
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
            "y": -15.0
          },
          "start": {
            "x": 0.0,
            "y": -15.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -15.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -15.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -14.2
                },
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -14.2
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
            "y": -20.0
          },
          "start": {
            "x": 0.0,
            "y": -20.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -20.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -20.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -19.2
                },
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -19.2
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
            "y": -25.0
          },
          "start": {
            "x": 0.0,
            "y": -25.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -25.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -25.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -24.2
                },
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -24.2
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
            "y": -30.0
          },
          "start": {
            "x": 0.0,
            "y": -30.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -30.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -30.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -29.2
                },
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -29.2
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
            "y": -35.0
          },
          "start": {
            "x": 0.0,
            "y": -35.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -35.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -35.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -34.2
                },
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -34.2
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
            "y": -40.0
          },
          "start": {
            "x": 0.0,
            "y": -40.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -40.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -40.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -39.2
                },
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -39.2
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
            "y": -45.0
          },
          "start": {
            "x": 0.0,
            "y": -45.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -45.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -45.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -44.2
                },
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -44.2
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
            "y": -50.0
          },
          "start": {
            "x": 0.0,
            "y": -50.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -50.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -50.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -49.2
                },
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -49.2
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
            "y": -55.0
          },
          "start": {
            "x": 0.0,
            "y": -55.0
          },
          "type": "line"
        },
        {
          "loops": [
            {
              "vertices": [
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -55.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -55.8
                },
                {
                  "bulge": 0,
                  "x": 14.0,
                  "y": -54.2
                },
                {
                  "bulge": 0,
                  "x": 10.0,
                  "y": -54.2
                }
              ]
            }
          ],
          "pattern": "SOLID",
          "type": "hatch"
        },
        {
          "closed": true,
          "lineType": "DASHED",
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 5.0,
              "y": 3.0
            },
            {
              "bulge": 0,
              "x": 17.0,
              "y": 3.0
            },
            {
              "bulge": 0,
              "x": 17.0,
              "y": -58.0
            },
            {
              "bulge": 0,
              "x": 5.0,
              "y": -58.0
            }
          ]
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": 0.8
          },
          "rotation": 0,
          "text": "01",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -4.2
          },
          "rotation": 0,
          "text": "02",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -9.2
          },
          "rotation": 0,
          "text": "03",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -14.2
          },
          "rotation": 0,
          "text": "04",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -19.2
          },
          "rotation": 0,
          "text": "05",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -24.2
          },
          "rotation": 0,
          "text": "06",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -29.2
          },
          "rotation": 0,
          "text": "07",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -34.2
          },
          "rotation": 0,
          "text": "08",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -39.2
          },
          "rotation": 0,
          "text": "09",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -44.2
          },
          "rotation": 0,
          "text": "10",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -49.2
          },
          "rotation": 0,
          "text": "11",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -54.2
          },
          "rotation": 0,
          "text": "12",
          "type": "text"
        }
      ],
      "id": "conector-12-macho",
      "nome": "Conector de 12 vias, macho (pinos)",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "01",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": 0.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "02",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -5.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "03",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -10.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "04",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "05",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -20.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "06",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -25.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "07",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -30.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "08",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -35.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "09",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -40.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "10",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -45.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "11",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -50.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "12",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -55.0
          },
          "required": false,
          "type": "eletrico"
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
            "x": 5.0,
            "y": 5.0
          },
          "prefixo": "X",
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
      "categoria": "conector",
      "formato": "traco-simbolo",
      "geometria": [
        {
          "end": {
            "x": 10.0,
            "y": 0.0
          },
          "start": {
            "x": 0.0,
            "y": 0.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": 0.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "end": {
            "x": 10.0,
            "y": -5.0
          },
          "start": {
            "x": 0.0,
            "y": -5.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": -5.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "end": {
            "x": 10.0,
            "y": -10.0
          },
          "start": {
            "x": 0.0,
            "y": -10.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": -10.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "end": {
            "x": 10.0,
            "y": -15.0
          },
          "start": {
            "x": 0.0,
            "y": -15.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": -15.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "end": {
            "x": 10.0,
            "y": -20.0
          },
          "start": {
            "x": 0.0,
            "y": -20.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": -20.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "end": {
            "x": 10.0,
            "y": -25.0
          },
          "start": {
            "x": 0.0,
            "y": -25.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": -25.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "end": {
            "x": 10.0,
            "y": -30.0
          },
          "start": {
            "x": 0.0,
            "y": -30.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": -30.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "end": {
            "x": 10.0,
            "y": -35.0
          },
          "start": {
            "x": 0.0,
            "y": -35.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": -35.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "end": {
            "x": 10.0,
            "y": -40.0
          },
          "start": {
            "x": 0.0,
            "y": -40.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": -40.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "end": {
            "x": 10.0,
            "y": -45.0
          },
          "start": {
            "x": 0.0,
            "y": -45.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": -45.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "end": {
            "x": 10.0,
            "y": -50.0
          },
          "start": {
            "x": 0.0,
            "y": -50.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": -50.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "end": {
            "x": 10.0,
            "y": -55.0
          },
          "start": {
            "x": 0.0,
            "y": -55.0
          },
          "type": "line"
        },
        {
          "center": {
            "x": 12.0,
            "y": -55.0
          },
          "end": 4.712389,
          "radius": 2.0,
          "start": 1.570796,
          "type": "arc"
        },
        {
          "closed": true,
          "lineType": "DASHED",
          "type": "polyline",
          "vertices": [
            {
              "bulge": 0,
              "x": 5.0,
              "y": 3.0
            },
            {
              "bulge": 0,
              "x": 17.0,
              "y": 3.0
            },
            {
              "bulge": 0,
              "x": 17.0,
              "y": -58.0
            },
            {
              "bulge": 0,
              "x": 5.0,
              "y": -58.0
            }
          ]
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": 0.8
          },
          "rotation": 0,
          "text": "01",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -4.2
          },
          "rotation": 0,
          "text": "02",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -9.2
          },
          "rotation": 0,
          "text": "03",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -14.2
          },
          "rotation": 0,
          "text": "04",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -19.2
          },
          "rotation": 0,
          "text": "05",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -24.2
          },
          "rotation": 0,
          "text": "06",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -29.2
          },
          "rotation": 0,
          "text": "07",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -34.2
          },
          "rotation": 0,
          "text": "08",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -39.2
          },
          "rotation": 0,
          "text": "09",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -44.2
          },
          "rotation": 0,
          "text": "10",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -49.2
          },
          "rotation": 0,
          "text": "11",
          "type": "text"
        },
        {
          "height": 2.0,
          "position": {
            "x": 0.8,
            "y": -54.2
          },
          "rotation": 0,
          "text": "12",
          "type": "text"
        }
      ],
      "id": "conector-12-femea",
      "nome": "Conector de 12 vias, fêmea (soquetes)",
      "norma": "IEC 60617",
      "portas": [
        {
          "name": "01",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": 0.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "02",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -5.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "03",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -10.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "04",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -15.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "05",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -20.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "06",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -25.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "07",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -30.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "08",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -35.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "09",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -40.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "10",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -45.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "11",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -50.0
          },
          "required": false,
          "type": "eletrico"
        },
        {
          "name": "12",
          "orientation": "w",
          "position": {
            "x": 0.0,
            "y": -55.0
          },
          "required": false,
          "type": "eletrico"
        }
      ],
      "unidade": "mm",
      "versao": 1
    }
  ]
};
