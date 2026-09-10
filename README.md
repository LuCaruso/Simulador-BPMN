# Simulador BPMN 2.0

Aplicação local (desktop, via navegador) para **abrir, criar, validar e simular** diagramas
BPMN 2.0. Lê arquivos `.bpmn` padrão e mostra o processo rodando com animação de tokens,
estatísticas de desempenho e verificação das regras da notação.

Base normativa: OMG **Business Process Model and Notation (BPMN) v2.0.2** (`formal/13-12-09`)
e os exemplos de **BPMN 2.0 by Example** (`dtc/2010-06-02`).

---

## Como iniciar

Dê **duplo clique** em:

```
Iniciar Simulador.bat
```

O `.bat` faz tudo sozinho:

1. localiza o Node.js (PATH, Program Files, `%LOCALAPPDATA%\Programs\nodejs` ou nvm);
2. resolve as dependências declaradas em `package.json` (`npm install`) quando houver;
3. garante a pasta `diagramas\` e copia o exemplo que estiver na raiz;
4. sobe o servidor local e **abre o navegador** em `http://localhost:4000`.

Para encerrar, feche a janela preta do servidor ou pressione `CTRL+C` nela.

> **Pré-requisito:** Node.js 16 ou superior (<https://nodejs.org>). É o único requisito —
> o projeto foi escrito **sem nenhuma dependência externa de npm**, então funciona
> offline e o `npm install` nunca é um bloqueio.

Se a porta 4000 estiver ocupada, o servidor tenta 4001, 4002... e informa o endereço no console.

---

## O que dá para fazer

### 1. Rodar um arquivo `.bpmn`

* Escolha um arquivo na lista **`-- diagramas da pasta /diagramas --`**, ou use
  **Abrir arquivo** para carregar um `.bpmn` de qualquer lugar do computador.
* Aperte **Iniciar**. Os *tokens* (bolinhas coloridas, uma cor por instância) percorrem
  o diagrama; a atividade em execução fica destacada em verde com barra de progresso, e
  quem está esperando fica em laranja tracejado.
* **Velocidade** controla quantos segundos simulados passam por segundo real.
  **Passo** avança 1 segundo por vez. **Reiniciar** zera tudo.

O painel direito mostra, ao vivo: tempo simulado, instâncias concluídas, tokens ativos,
tempo de ciclo médio e o **registro de execução** (clique numa linha para centralizar o
elemento correspondente no diagrama).

### 2. Parâmetros da simulação

| Parâmetro | Para que serve |
|---|---|
| Evento de início | Qual evento dispara as instâncias (quando há mais de um) |
| Instâncias a criar | Quantos casos rodar |
| Intervalo entre chegadas | Tempo entre a criação de uma instância e a próxima |
| Duração padrão min/máx | Usada nas atividades que não têm duração própria |
| Tempo no fluxo | Duração da animação em cada seta |
| Espera de mensagem externa | Quanto demora um participante externo (piscina caixa-preta) a responder |
| Decisão nos gateways | **Automática** (por probabilidade) ou **Perguntar** (você escolhe o caminho a cada decisão) |
| Mapa de calor | Colore os elementos pela frequência de execução |

Duração, custo e recurso podem ser definidos **por atividade** na aba *Propriedades*;
a **probabilidade** de cada caminho é definida no fluxo de sequência que sai do gateway.

### 3. Criar diagramas na própria ferramenta

**Inserir um elemento** — três caminhos, use o que for mais natural:

* **Arraste** o item da paleta direto para o quadro;
* ou **clique** no item da paleta e depois clique no quadro;
* ou **duplo clique** no espaço vazio, que insere uma tarefa ali mesmo.

Use a **busca da paleta** para achar um elemento pelo nome em vez de garimpar na lista.

**Ligar dois elementos** — clique num elemento e aparece um **pad de ações** ao lado dele:

| Botão | O que faz |
|---|---|
| **→** | Fluxo de sequência: **arraste** até o destino, ou solte e clique no destino |
| **✉** | Fluxo de mensagem (só entre piscinas diferentes) |
| **⏱** | Anexa evento de borda de temporizador |
| **✎** | Renomear / abrir propriedades |
| **⧉** | Duplicar |
| **🗑** | Excluir |

Enquanto você arrasta, o alvo fica **verde** se a ligação é válida e **vermelho tracejado**
se não é. Conexões proibidas pela notação são recusadas com a explicação e a cláusula da
especificação (ex.: fluxo de sequência não cruza piscina — cláusula 7.6.1).

**Botão direito** abre o menu de ações do elemento (ou, no espaço vazio, insere elementos,
organiza e ajusta o zoom).

**Outras ações**

* Arraste para mover (piscinas e raias levam o conteúdo junto); alças nos cantos redimensionam.
* Selecionar um elemento abre a aba **Propriedades** sozinha.
* **Organizar** reorganiza o diagrama da esquerda para a direita, respeitando as raias.
* **Salvar** grava em `diagramas\` (a versão anterior vai para `diagramas\_backup\`).
  **Exportar** baixa `.bpmn`, SVG ou PNG.

**Atalhos**

| Tecla | Ação |
|---|---|
| `Delete` | Excluir seleção |
| `Ctrl`+`Z` / `Ctrl`+`Y` | Desfazer / refazer |
| `Ctrl`+`S` | Salvar |
| `Ctrl`+`D` | Duplicar |
| `F2` ou duplo clique | Renomear |
| Setas (`Shift` = passo maior) | Mover a seleção |
| `Esc` | Cancelar ligação / voltar ao modo selecionar |
| Roda do mouse | Zoom |

A barra inferior mostra sempre **o que fazer agora** no modo atual, e o botão **?** no topo
reabre o guia de boas-vindas.

### 4. Validação da notação

A aba **Validação** aponta, com a cláusula do BPMN 2.0.2 que sustenta cada regra:

* **Erros** — processo sem evento de início; evento de início recebendo fluxo; evento de
  fim com saída; fluxo de sequência cruzando piscina; fluxo de mensagem dentro da mesma
  piscina; origem/alvo inválido (Tabelas 7.3 e 7.4); gatilho de evento não permitido para
  o tipo (10.5); gateway baseado em evento mal configurado (10.6.6); IDs duplicados.
* **Avisos** — processo sem evento de fim; elementos desconectados ou inalcançáveis;
  gateway divergente sem condições nem fluxo padrão; divisão implícita numa atividade;
  gateway que não decide nem sincroniza.
* **Dicas** — boas práticas: nomear atividade como "verbo + substantivo", nomear gateway
  como pergunta, rotular mensagens, identificar raias.

Clique num achado para selecionar e centralizar o elemento.

### 5. Tema claro / escuro

No canto superior direito há um seletor com três opções:

| Opção | Comportamento |
|---|---|
| ☀ **Claro** | Base branca, texto preto, vermelho Insper nos destaques |
| ☾ **Escuro** | Base no azul escuro PANTONE 5395 C, cores secundárias em cheio |
| 🖵 **Sistema** | Acompanha o `prefers-color-scheme` do Windows e muda sozinho quando você troca o tema do sistema |

A escolha fica salva no navegador (`localStorage`) e é aplicada **antes** da primeira
pintura da tela, então não há piscada ao abrir. O diagrama também troca de tema: no modo
escuro as formas ganham fundo escuro e contorno claro, e os eventos usam as cores
secundárias da marca, que têm mais contraste sobre fundo escuro.

**Exportações em SVG e PNG saem sempre no tema claro**, com fundo branco — que é o
esperado para impressão, relatórios e slides, independentemente do tema em uso na tela.

### 6. Estatísticas

Aba **Estatísticas**: tempo de ciclo médio/mín/máx, tempo em atividade *vs.* tempo em
espera, **eficiência do ciclo**, custo acumulado, tabela por elemento (execuções, tempo
total, médio e de espera) e destaque dos **gargalos**. Botão **Exportar CSV**.

---

## Semântica implementada

O motor é baseado em tokens, seguindo a cláusula 10.6 da especificação:

| Elemento | Comportamento |
|---|---|
| Gateway exclusivo (X) | Divergente segue **um** caminho (probabilidade, fluxo padrão ou escolha manual); convergente repassa cada token **sem sincronizar** (10.6.2) |
| Gateway paralelo (+) | Divergente gera um token por saída; convergente **espera todas** as entradas (10.6.4) |
| Gateway inclusivo (O) | Divergente ativa os caminhos verdadeiros (pelo menos um); convergente sincroniza enquanto **algum token ainda puder chegar** (10.6.3) |
| Gateway baseado em evento | Vence o evento que ocorreria primeiro (10.6.6) |
| Evento de fim de terminação | Encerra imediatamente todos os tokens da instância (10.5.3) |
| Evento de borda | Temporizador interrompente cancela a atividade e desvia o fluxo; não interrompente gera um token paralelo (10.5.6) |
| Fluxo de mensagem | Tarefas de envio e eventos de disparo emitem a mensagem; eventos de captura esperam por ela. Piscinas caixa-preta respondem após o atraso configurado |
| Loop / multi-instância | Marcadores são desenhados; a repetição real vem do próprio desenho do fluxo |

---

## Identidade visual

Cores e tipografia seguem o **Guia de Marca do Insper** (abril de 2024) e o repositório
oficial de cores da instituição:

| Papel | Cor | Referência |
|---|---|---|
| Cor principal | `#E50505` | Vermelho PANTONE 2034 C |
| Cor principal | `#000000` / `#FFFFFF` | Preto e Branco |
| Secundárias | `#3ACC9F` `#92D053` `#FFCC00` `#F89D49` `#F47DCD` `#730D9F` | Turquesa, Verde, Amarelo, Laranja, Rosa, Roxo |
| Cinzas | `#DCDCDC` `#808080` `#5B5B5B` `#3F3F3F` | Cool Gray 1/8 C e Black 7 C |
| Base do tema escuro | `#0E171D` | PANTONE 5395 C |
| Tipografia digital | **Inter** | Guia de Marca, seção 2.2.2 |

A fonte Inter (licença SIL OFL) está **embutida em `public/fonts/`** — 136 KB, dois
arquivos variáveis — para o app continuar funcionando sem internet. Tons marcados como
"derivado" no CSS são clareamentos ou escurecimentos das cores oficiais, usados apenas
onde o contraste exige (por exemplo, o verde `#92D053` escurecido para `#4D8C14` quando
vira contorno fino sobre fundo branco).

Todas as cores da interface e do diagrama são **tokens CSS** (`--marca`, `--fundo`,
`--dg-traco`, ...) redefinidos em `[data-tema="dark"]`, então trocar o tema não repinta
nada na mão: é só o atributo `data-tema` no `<html>`.

> Observação: o app usa a **paleta e a tipografia** da marca, mas não reproduz o logotipo
> do Insper. O símbolo do cabeçalho é um ícone próprio do simulador.

## Estrutura do projeto

```
Simulador BPMN/
├─ Iniciar Simulador.bat      inicializador (Node + dependências + servidor + navegador)
├─ server.js                  servidor HTTP local, só com módulos nativos do Node
├─ package.json               sem dependências externas
├─ diagramas/                 seus arquivos .bpmn (e _backup/ das versões anteriores)
│  ├─ pizzaria-delivery-as-is.bpmn
│  ├─ exemplo-compras.bpmn    exemplo didático gerado pela própria ferramenta
│  └─ cafeteria-balcao-as-is.bpmn   AS-IS de atendimento em balcão de cafeteria
└─ public/
   ├─ index.html
   ├─ fonts/                  Inter (SIL OFL), embutida para uso offline
   ├─ css/
   │  ├─ app.css              tokens de tema (claro/escuro) + estilos
   │  └─ fontes.css           @font-face da Inter
   └─ js/
      ├─ util.js              geometria, texto, formatação
      ├─ bpmn-spec.js         catálogo de elementos e regras de conexão (7.6)
      ├─ parser.js            .bpmn (XML + DI) -> modelo interno
      ├─ layout.js            layout automático quando não há DI
      ├─ renderer.js          desenho SVG da notação
      ├─ validator.js         regras de conformidade BPMN 2.0.2
      ├─ serializer.js        modelo -> .bpmn com BPMN DI
      ├─ simulator.js         motor de tokens
      ├─ editor.js            criação, movimentação, conexão, desfazer/refazer
      └─ app.js               interface e integração
```

## Compatibilidade dos arquivos

A leitura ignora prefixos de namespace, então arquivos exportados por Camunda Modeler,
bpmn.io, Bizagi e afins são aceitos. Arquivos **sem BPMN DI** (sem coordenadas) também
abrem: o layout automático posiciona tudo. Os parâmetros de simulação são gravados em
`<bpmn:extensionElements>` no namespace `sim:`, que outras ferramentas simplesmente ignoram.
