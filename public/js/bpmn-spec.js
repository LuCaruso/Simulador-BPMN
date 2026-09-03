/*
 * Catalogo de elementos e REGRAS DE NOTACAO do BPMN 2.0.2
 * Base normativa: OMG "Business Process Model and Notation (BPMN) v2.0.2"
 * (formal/13-12-09), clausulas 7.3 (elementos), 7.6 (regras de conexao),
 * 10.3 (atividades), 10.5 (eventos), 10.6 (gateways), 10.8 (raias).
 * Exemplos: OMG "BPMN 2.0 by Example" (dtc/2010-06-02).
 */
(function (global) {
  'use strict';
  var SB = global.SB || (global.SB = {});

  /* ------------------------------------------------------------------
   * 1) Tipos de elemento
   * ------------------------------------------------------------------ */
  var TIPOS = {
    /* --- Eventos (10.5) - circulo -------------------------------- */
    startEvent: { rotulo: 'Evento de inicio', categoria: 'evento', papel: 'inicio', w: 36, h: 36, forma: 'circulo' },
    intermediateCatchEvent: { rotulo: 'Evento intermediario (captura)', categoria: 'evento', papel: 'intermediario', w: 36, h: 36, forma: 'circulo' },
    intermediateThrowEvent: { rotulo: 'Evento intermediario (disparo)', categoria: 'evento', papel: 'intermediario', w: 36, h: 36, forma: 'circulo' },
    boundaryEvent: { rotulo: 'Evento de borda', categoria: 'evento', papel: 'borda', w: 36, h: 36, forma: 'circulo' },
    endEvent: { rotulo: 'Evento de fim', categoria: 'evento', papel: 'fim', w: 36, h: 36, forma: 'circulo' },

    /* --- Atividades (10.3) - retangulo arredondado --------------- */
    task: { rotulo: 'Tarefa (abstrata)', categoria: 'atividade', w: 120, h: 80, forma: 'retangulo' },
    userTask: { rotulo: 'Tarefa de usuario', categoria: 'atividade', w: 120, h: 80, forma: 'retangulo', marcador: 'user' },
    manualTask: { rotulo: 'Tarefa manual', categoria: 'atividade', w: 120, h: 80, forma: 'retangulo', marcador: 'manual' },
    serviceTask: { rotulo: 'Tarefa de servico', categoria: 'atividade', w: 120, h: 80, forma: 'retangulo', marcador: 'service' },
    scriptTask: { rotulo: 'Tarefa de script', categoria: 'atividade', w: 120, h: 80, forma: 'retangulo', marcador: 'script' },
    sendTask: { rotulo: 'Tarefa de envio', categoria: 'atividade', w: 120, h: 80, forma: 'retangulo', marcador: 'send' },
    receiveTask: { rotulo: 'Tarefa de recebimento', categoria: 'atividade', w: 120, h: 80, forma: 'retangulo', marcador: 'receive' },
    businessRuleTask: { rotulo: 'Tarefa de regra de negocio', categoria: 'atividade', w: 120, h: 80, forma: 'retangulo', marcador: 'rule' },
    callActivity: { rotulo: 'Atividade de chamada', categoria: 'atividade', w: 120, h: 80, forma: 'retangulo', bordaGrossa: true },
    subProcess: { rotulo: 'Subprocesso', categoria: 'atividade', w: 200, h: 130, forma: 'retangulo', container: true },
    transaction: { rotulo: 'Transacao', categoria: 'atividade', w: 200, h: 130, forma: 'retangulo', container: true, bordaDupla: true },
    adHocSubProcess: { rotulo: 'Subprocesso ad-hoc', categoria: 'atividade', w: 200, h: 130, forma: 'retangulo', container: true },

    /* --- Gateways (10.6) - losango ------------------------------- */
    exclusiveGateway: { rotulo: 'Gateway exclusivo (XOR)', categoria: 'gateway', w: 50, h: 50, forma: 'losango', marcador: 'X' },
    parallelGateway: { rotulo: 'Gateway paralelo (AND)', categoria: 'gateway', w: 50, h: 50, forma: 'losango', marcador: '+' },
    inclusiveGateway: { rotulo: 'Gateway inclusivo (OR)', categoria: 'gateway', w: 50, h: 50, forma: 'losango', marcador: 'O' },
    eventBasedGateway: { rotulo: 'Gateway baseado em evento', categoria: 'gateway', w: 50, h: 50, forma: 'losango', marcador: 'evento' },
    complexGateway: { rotulo: 'Gateway complexo', categoria: 'gateway', w: 50, h: 50, forma: 'losango', marcador: '*' },

    /* --- Dados (10.4) -------------------------------------------- */
    dataObjectReference: { rotulo: 'Objeto de dados', categoria: 'dado', w: 36, h: 50, forma: 'documento' },
    dataStoreReference: { rotulo: 'Armazenamento de dados', categoria: 'dado', w: 50, h: 50, forma: 'cilindro' },

    /* --- Artefatos (8.4.1) --------------------------------------- */
    textAnnotation: { rotulo: 'Anotacao de texto', categoria: 'artefato', w: 180, h: 60, forma: 'anotacao' },
    group: { rotulo: 'Agrupamento', categoria: 'artefato', w: 300, h: 200, forma: 'grupo' },

    /* --- Raias (10.8 / 9.3) -------------------------------------- */
    participant: { rotulo: 'Piscina (participante)', categoria: 'container', w: 900, h: 260, forma: 'piscina' },
    lane: { rotulo: 'Raia', categoria: 'container', w: 870, h: 130, forma: 'raia' }
  };

  /* ------------------------------------------------------------------
   * 2) Definicoes de evento permitidas por tipo (10.5.2 a 10.5.5)
   * ------------------------------------------------------------------ */
  var DEFINICOES = {
    none: { rotulo: 'Simples (none)', simbolo: '' },
    message: { rotulo: 'Mensagem', simbolo: 'envelope' },
    timer: { rotulo: 'Temporizador', simbolo: 'relogio' },
    error: { rotulo: 'Erro', simbolo: 'raio' },
    escalation: { rotulo: 'Escalonamento', simbolo: 'seta' },
    cancel: { rotulo: 'Cancelamento', simbolo: 'xis' },
    compensate: { rotulo: 'Compensacao', simbolo: 'rebobinar' },
    conditional: { rotulo: 'Condicional', simbolo: 'lista' },
    link: { rotulo: 'Link', simbolo: 'link' },
    signal: { rotulo: 'Sinal', simbolo: 'triangulo' },
    terminate: { rotulo: 'Terminacao', simbolo: 'circuloCheio' },
    multiple: { rotulo: 'Multiplo', simbolo: 'pentagono' },
    parallelMultiple: { rotulo: 'Multiplo paralelo', simbolo: 'cruz' }
  };

  var DEFINICOES_PERMITIDAS = {
    startEvent: ['none', 'message', 'timer', 'conditional', 'signal', 'multiple', 'parallelMultiple', 'error', 'escalation', 'compensate'],
    intermediateCatchEvent: ['message', 'timer', 'conditional', 'link', 'signal', 'multiple', 'parallelMultiple'],
    intermediateThrowEvent: ['none', 'message', 'escalation', 'compensate', 'link', 'signal', 'multiple'],
    boundaryEvent: ['message', 'timer', 'escalation', 'error', 'cancel', 'compensate', 'conditional', 'signal', 'multiple', 'parallelMultiple'],
    endEvent: ['none', 'message', 'error', 'escalation', 'cancel', 'compensate', 'signal', 'terminate', 'multiple']
  };

  /* ------------------------------------------------------------------
   * 3) Regras de conexao (clausula 7.6)
   * ------------------------------------------------------------------ */

  // Tabela 7.3 - Fluxo de sequencia
  function podeSerOrigemSequencia(tipo) {
    var t = TIPOS[tipo];
    if (!t) return false;
    if (t.categoria === 'atividade' || t.categoria === 'gateway') return true;
    if (tipo === 'startEvent' || tipo === 'boundaryEvent') return true;
    if (tipo === 'intermediateCatchEvent' || tipo === 'intermediateThrowEvent') return true;
    return false; // endEvent nunca tem fluxo de saida
  }
  function podeSerAlvoSequencia(tipo) {
    var t = TIPOS[tipo];
    if (!t) return false;
    if (t.categoria === 'atividade' || t.categoria === 'gateway') return true;
    if (tipo === 'endEvent') return true;
    if (tipo === 'intermediateCatchEvent' || tipo === 'intermediateThrowEvent') return true;
    return false; // startEvent e boundaryEvent nunca recebem fluxo de sequencia
  }

  // Tabela 7.4 - Fluxo de mensagem (so entre piscinas diferentes)
  function podeSerOrigemMensagem(tipo, definicoes) {
    if (tipo === 'participant') return true;
    if (TIPOS[tipo] && TIPOS[tipo].categoria === 'atividade') return true;
    if (tipo === 'intermediateThrowEvent') return temDef(definicoes, 'message');
    if (tipo === 'endEvent') return temDef(definicoes, 'message');
    return false;
  }
  function podeSerAlvoMensagem(tipo, definicoes) {
    if (tipo === 'participant') return true;
    if (TIPOS[tipo] && TIPOS[tipo].categoria === 'atividade') return true;
    if (tipo === 'startEvent') return temDef(definicoes, 'message') || temDef(definicoes, 'multiple') || temDef(definicoes, 'parallelMultiple');
    if (tipo === 'intermediateCatchEvent') return temDef(definicoes, 'message') || temDef(definicoes, 'multiple') || temDef(definicoes, 'parallelMultiple');
    if (tipo === 'boundaryEvent') return temDef(definicoes, 'message');
    return false;
  }
  function temDef(defs, nome) {
    if (!defs || !defs.length) return false;
    return defs.indexOf(nome) !== -1;
  }

  /* ------------------------------------------------------------------
   * 4) Paleta do editor
   * ------------------------------------------------------------------ */
  var PALETA = [
    {
      grupo: 'Eventos',
      itens: [
        { tipo: 'startEvent', def: 'none', rotulo: 'Inicio' },
        { tipo: 'startEvent', def: 'message', rotulo: 'Inicio mensagem' },
        { tipo: 'startEvent', def: 'timer', rotulo: 'Inicio temporizador' },
        { tipo: 'intermediateCatchEvent', def: 'timer', rotulo: 'Interm. temporizador' },
        { tipo: 'intermediateCatchEvent', def: 'message', rotulo: 'Interm. recebe msg' },
        { tipo: 'intermediateThrowEvent', def: 'message', rotulo: 'Interm. envia msg' },
        { tipo: 'endEvent', def: 'none', rotulo: 'Fim' },
        { tipo: 'endEvent', def: 'message', rotulo: 'Fim mensagem' },
        { tipo: 'endEvent', def: 'terminate', rotulo: 'Fim terminacao' }
      ]
    },
    {
      grupo: 'Atividades',
      itens: [
        { tipo: 'task', rotulo: 'Tarefa' },
        { tipo: 'userTask', rotulo: 'Tarefa de usuario' },
        { tipo: 'manualTask', rotulo: 'Tarefa manual' },
        { tipo: 'serviceTask', rotulo: 'Tarefa de servico' },
        { tipo: 'sendTask', rotulo: 'Enviar' },
        { tipo: 'receiveTask', rotulo: 'Receber' },
        { tipo: 'businessRuleTask', rotulo: 'Regra de negocio' },
        { tipo: 'scriptTask', rotulo: 'Script' },
        { tipo: 'subProcess', rotulo: 'Subprocesso' },
        { tipo: 'callActivity', rotulo: 'Chamada' }
      ]
    },
    {
      grupo: 'Gateways',
      itens: [
        { tipo: 'exclusiveGateway', rotulo: 'Exclusivo (XOR)' },
        { tipo: 'parallelGateway', rotulo: 'Paralelo (AND)' },
        { tipo: 'inclusiveGateway', rotulo: 'Inclusivo (OR)' },
        { tipo: 'eventBasedGateway', rotulo: 'Baseado em evento' },
        { tipo: 'complexGateway', rotulo: 'Complexo' }
      ]
    },
    {
      grupo: 'Dados e artefatos',
      itens: [
        { tipo: 'dataObjectReference', rotulo: 'Objeto de dados' },
        { tipo: 'dataStoreReference', rotulo: 'Armazenamento' },
        { tipo: 'textAnnotation', rotulo: 'Anotacao' },
        { tipo: 'group', rotulo: 'Agrupamento' }
      ]
    },
    {
      grupo: 'Raias',
      itens: [
        { tipo: 'participant', rotulo: 'Piscina' },
        { tipo: 'lane', rotulo: 'Raia' }
      ]
    }
  ];

  function categoria(tipo) { return TIPOS[tipo] ? TIPOS[tipo].categoria : 'desconhecido'; }
  function ehEvento(tipo) { return categoria(tipo) === 'evento'; }
  function ehAtividade(tipo) { return categoria(tipo) === 'atividade'; }
  function ehGateway(tipo) { return categoria(tipo) === 'gateway'; }
  function ehContainerRaia(tipo) { return tipo === 'participant' || tipo === 'lane'; }
  function rotulo(tipo) { return TIPOS[tipo] ? TIPOS[tipo].rotulo : tipo; }

  SB.spec = {
    TIPOS: TIPOS,
    DEFINICOES: DEFINICOES,
    DEFINICOES_PERMITIDAS: DEFINICOES_PERMITIDAS,
    PALETA: PALETA,
    categoria: categoria,
    rotulo: rotulo,
    ehEvento: ehEvento,
    ehAtividade: ehAtividade,
    ehGateway: ehGateway,
    ehContainerRaia: ehContainerRaia,
    temDef: temDef,
    podeSerOrigemSequencia: podeSerOrigemSequencia,
    podeSerAlvoSequencia: podeSerAlvoSequencia,
    podeSerOrigemMensagem: podeSerOrigemMensagem,
    podeSerAlvoMensagem: podeSerAlvoMensagem
  };
})(window);
