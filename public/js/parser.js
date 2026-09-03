/*
 * Leitor de arquivos .bpmn (BPMN 2.0 XML + BPMN DI) -> modelo interno.
 * Independente de prefixo de namespace: usa sempre localName.
 */
(function (global) {
  'use strict';
  var SB = global.SB || (global.SB = {});
  var spec = SB.spec;

  var TIPOS_NO = {
    startEvent: 1, endEvent: 1, intermediateCatchEvent: 1, intermediateThrowEvent: 1, boundaryEvent: 1,
    task: 1, userTask: 1, manualTask: 1, serviceTask: 1, scriptTask: 1, sendTask: 1, receiveTask: 1,
    businessRuleTask: 1, callActivity: 1, subProcess: 1, transaction: 1, adHocSubProcess: 1,
    exclusiveGateway: 1, parallelGateway: 1, inclusiveGateway: 1, eventBasedGateway: 1, complexGateway: 1
  };

  var DEFS_EVENTO = {
    messageEventDefinition: 'message',
    timerEventDefinition: 'timer',
    errorEventDefinition: 'error',
    escalationEventDefinition: 'escalation',
    cancelEventDefinition: 'cancel',
    compensateEventDefinition: 'compensate',
    conditionalEventDefinition: 'conditional',
    linkEventDefinition: 'link',
    signalEventDefinition: 'signal',
    terminateEventDefinition: 'terminate'
  };

  function filhos(no, nome) {
    var out = [];
    for (var i = 0; i < no.childNodes.length; i++) {
      var c = no.childNodes[i];
      if (c.nodeType !== 1) continue;
      if (!nome || c.localName === nome) out.push(c);
    }
    return out;
  }
  function primeiroFilho(no, nome) {
    var l = filhos(no, nome);
    return l.length ? l[0] : null;
  }
  function attr(no, nome, padrao) {
    if (!no || !no.getAttribute) return padrao;
    var v = no.getAttribute(nome);
    return v === null || v === undefined ? padrao : v;
  }
  function bool(v, padrao) {
    if (v === undefined || v === null || v === '') return padrao;
    return String(v) === 'true';
  }
  function num(v, padrao) {
    var n = parseFloat(v);
    return isNaN(n) ? padrao : n;
  }

  function novoModelo() {
    return {
      definitionsId: 'Definitions_1',
      targetNamespace: 'http://bpmn.io/schema/bpmn',
      exporter: 'Simulador BPMN',
      exporterVersion: '1.0.0',
      nome: 'Novo diagrama',
      elementos: {},
      ordem: [],
      fluxos: {},
      ordemFluxos: [],
      processos: {},
      ordemProcessos: [],
      colaboracao: null,
      diagramaId: 'BPMNDiagram_1',
      planoId: 'BPMNPlane_1',
      planoElemento: null,
      avisosLeitura: []
    };
  }

  function addElemento(m, e) {
    m.elementos[e.id] = e;
    if (m.ordem.indexOf(e.id) === -1) m.ordem.push(e.id);
    return e;
  }
  function addFluxo(m, f) {
    m.fluxos[f.id] = f;
    if (m.ordemFluxos.indexOf(f.id) === -1) m.ordemFluxos.push(f.id);
    return f;
  }

  /* ---------------------------------------------------------------- */

  function lerDocumentacao(no) {
    var d = primeiroFilho(no, 'documentation');
    return d ? (d.textContent || '').trim() : '';
  }

  function lerExtensaoSimulacao(no) {
    // <bpmn:extensionElements><sim:parametros duracaoMin=".." .../></bpmn:extensionElements>
    var ext = primeiroFilho(no, 'extensionElements');
    if (!ext) return null;
    var lista = filhos(ext);
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].localName === 'parametros' || lista[i].localName === 'simulacao') {
        var p = lista[i];
        return {
          duracaoMin: num(attr(p, 'duracaoMin'), undefined),
          duracaoMax: num(attr(p, 'duracaoMax'), undefined),
          custo: num(attr(p, 'custo'), undefined),
          recurso: attr(p, 'recurso', undefined),
          probabilidade: num(attr(p, 'probabilidade'), undefined)
        };
      }
    }
    return null;
  }

  function lerNo(m, no, paiId, participantId) {
    var tipo = no.localName;
    if (!TIPOS_NO[tipo]) return null;

    var e = {
      id: attr(no, 'id', SB.util.uid(tipo)),
      tipo: tipo,
      nome: attr(no, 'name', ''),
      pai: paiId,
      participantId: participantId || null,
      laneId: null,
      definicoes: [],
      bounds: null,
      documentacao: lerDocumentacao(no),
      sim: lerExtensaoSimulacao(no) || {}
    };

    // definicoes de evento
    filhos(no).forEach(function (c) {
      var d = DEFS_EVENTO[c.localName];
      if (d) e.definicoes.push(d);
    });
    if (spec.ehEvento(tipo) && e.definicoes.length === 0) e.definicoes = ['none'];
    if (e.definicoes.length > 1) e.definicoes = e.definicoes; // multiplo tratado no render

    if (tipo === 'boundaryEvent') {
      e.attachedToRef = attr(no, 'attachedToRef', null);
      e.cancelActivity = bool(attr(no, 'cancelActivity'), true);
    }
    if (tipo === 'subProcess' || tipo === 'transaction' || tipo === 'adHocSubProcess') {
      e.triggeredByEvent = bool(attr(no, 'triggeredByEvent'), false);
      e.expandido = true;
    }
    if (tipo === 'callActivity') e.calledElement = attr(no, 'calledElement', '');
    if (tipo === 'exclusiveGateway' || tipo === 'inclusiveGateway' || tipo === 'complexGateway') {
      e.padrao = attr(no, 'default', null);
    }
    if (spec.ehAtividade(tipo)) {
      var std = primeiroFilho(no, 'standardLoopCharacteristics');
      var mi = primeiroFilho(no, 'multiInstanceLoopCharacteristics');
      if (std) e.loop = 'standard';
      else if (mi) e.loop = bool(attr(mi, 'isSequential'), false) ? 'sequencial' : 'paralelo';
      e.forCompensation = bool(attr(no, 'isForCompensation'), false);
    }

    addElemento(m, e);

    // subprocessos: le filhos recursivamente
    if (tipo === 'subProcess' || tipo === 'transaction' || tipo === 'adHocSubProcess') {
      lerConteudoContainer(m, no, e.id, participantId);
    }
    return e;
  }

  function lerFluxoSequencia(m, no, paiId) {
    var cond = primeiroFilho(no, 'conditionExpression');
    return addFluxo(m, {
      id: attr(no, 'id', SB.util.uid('Flow')),
      tipo: 'sequenceFlow',
      nome: attr(no, 'name', ''),
      origem: attr(no, 'sourceRef', null),
      alvo: attr(no, 'targetRef', null),
      condicao: cond ? (cond.textContent || '').trim() : '',
      pai: paiId,
      waypoints: [],
      sim: lerExtensaoSimulacao(no) || {}
    });
  }

  function lerConteudoContainer(m, container, paiId, participantId) {
    filhos(container).forEach(function (c) {
      var t = c.localName;
      if (TIPOS_NO[t]) {
        lerNo(m, c, paiId, participantId);
      } else if (t === 'sequenceFlow') {
        lerFluxoSequencia(m, c, paiId);
      } else if (t === 'textAnnotation') {
        var txt = primeiroFilho(c, 'text');
        addElemento(m, {
          id: attr(c, 'id', SB.util.uid('Annotation')),
          tipo: 'textAnnotation',
          nome: '',
          texto: txt ? (txt.textContent || '').trim() : attr(c, 'text', ''),
          pai: paiId,
          participantId: participantId || null,
          definicoes: [],
          bounds: null
        });
      } else if (t === 'group') {
        addElemento(m, {
          id: attr(c, 'id', SB.util.uid('Group')),
          tipo: 'group',
          nome: attr(c, 'categoryValueRef', ''),
          pai: paiId,
          participantId: participantId || null,
          definicoes: [],
          bounds: null
        });
      } else if (t === 'association' || t === 'dataInputAssociation' || t === 'dataOutputAssociation') {
        addFluxo(m, {
          id: attr(c, 'id', SB.util.uid('Assoc')),
          tipo: 'association',
          nome: '',
          origem: attr(c, 'sourceRef', null),
          alvo: attr(c, 'targetRef', null),
          pai: paiId,
          waypoints: []
        });
      } else if (t === 'dataObjectReference' || t === 'dataStoreReference' || t === 'dataObject') {
        if (t === 'dataObject') return; // referenciado pelo dataObjectReference
        addElemento(m, {
          id: attr(c, 'id', SB.util.uid('Data')),
          tipo: t,
          nome: attr(c, 'name', ''),
          pai: paiId,
          participantId: participantId || null,
          definicoes: [],
          bounds: null
        });
      }
    });
  }

  function lerLanes(m, laneSetNo, processoId, participantId, profundidade) {
    filhos(laneSetNo, 'lane').forEach(function (l) {
      var lane = addElemento(m, {
        id: attr(l, 'id', SB.util.uid('Lane')),
        tipo: 'lane',
        nome: attr(l, 'name', ''),
        pai: processoId,
        participantId: participantId,
        definicoes: [],
        bounds: null,
        nivel: profundidade || 0,
        refs: []
      });
      filhos(l, 'flowNodeRef').forEach(function (r) {
        var idRef = (r.textContent || '').trim();
        lane.refs.push(idRef);
        if (m.elementos[idRef]) m.elementos[idRef].laneId = lane.id;
      });
      var filho = primeiroFilho(l, 'childLaneSet');
      if (filho) lerLanes(m, filho, processoId, participantId, (profundidade || 0) + 1);
    });
  }

  function lerProcesso(m, no, participantId) {
    var pid = attr(no, 'id', SB.util.uid('Process'));
    m.processos[pid] = {
      id: pid,
      nome: attr(no, 'name', ''),
      isExecutable: bool(attr(no, 'isExecutable'), false),
      participantId: participantId || null
    };
    if (m.ordemProcessos.indexOf(pid) === -1) m.ordemProcessos.push(pid);
    lerConteudoContainer(m, no, pid, participantId);
    var ls = primeiroFilho(no, 'laneSet');
    if (ls) lerLanes(m, ls, pid, participantId, 0);
    return pid;
  }

  function lerDI(m, diagramaNo) {
    m.diagramaId = attr(diagramaNo, 'id', 'BPMNDiagram_1');
    var plano = primeiroFilho(diagramaNo, 'BPMNPlane');
    if (!plano) return;
    m.planoId = attr(plano, 'id', 'BPMNPlane_1');
    m.planoElemento = attr(plano, 'bpmnElement', null);

    filhos(plano).forEach(function (f) {
      var alvo = attr(f, 'bpmnElement', null);
      if (!alvo) return;
      if (f.localName === 'BPMNShape') {
        var b = primeiroFilho(f, 'Bounds');
        if (!b) return;
        var bounds = {
          x: num(attr(b, 'x'), 0),
          y: num(attr(b, 'y'), 0),
          width: num(attr(b, 'width'), 100),
          height: num(attr(b, 'height'), 80)
        };
        var e = m.elementos[alvo];
        if (e) {
          e.bounds = bounds;
          e.isHorizontal = bool(attr(f, 'isHorizontal'), true);
          e.expandidoDI = attr(f, 'isExpanded', null);
          if (e.expandidoDI !== null) e.expandido = bool(e.expandidoDI, true);
          var lbl = primeiroFilho(f, 'BPMNLabel');
          var lb = lbl ? primeiroFilho(lbl, 'Bounds') : null;
          if (lb) {
            e.labelBounds = {
              x: num(attr(lb, 'x'), 0), y: num(attr(lb, 'y'), 0),
              width: num(attr(lb, 'width'), 90), height: num(attr(lb, 'height'), 20)
            };
          }
        }
      } else if (f.localName === 'BPMNEdge') {
        var fl = m.fluxos[alvo];
        if (!fl) return;
        fl.waypoints = filhos(f, 'waypoint').map(function (w) {
          return { x: num(attr(w, 'x'), 0), y: num(attr(w, 'y'), 0) };
        });
        var lbl2 = primeiroFilho(f, 'BPMNLabel');
        var lb2 = lbl2 ? primeiroFilho(lbl2, 'Bounds') : null;
        if (lb2) {
          fl.labelBounds = {
            x: num(attr(lb2, 'x'), 0), y: num(attr(lb2, 'y'), 0),
            width: num(attr(lb2, 'width'), 90), height: num(attr(lb2, 'height'), 20)
          };
        }
      }
    });
  }

  /** Propaga participantId/laneId a partir da geometria quando o XML nao informa. */
  function inferirContainers(m) {
    var piscinas = m.ordem.map(function (id) { return m.elementos[id]; })
      .filter(function (e) { return e.tipo === 'participant' && e.bounds; });
    var raias = m.ordem.map(function (id) { return m.elementos[id]; })
      .filter(function (e) { return e.tipo === 'lane' && e.bounds; });

    m.ordem.forEach(function (id) {
      var e = m.elementos[id];
      if (!e.bounds || e.tipo === 'participant' || e.tipo === 'lane') return;
      var c = SB.util.centro(e.bounds);
      if (!e.participantId) {
        for (var i = 0; i < piscinas.length; i++) {
          var b = piscinas[i].bounds;
          if (c.x >= b.x && c.x <= b.x + b.width && c.y >= b.y && c.y <= b.y + b.height) {
            e.participantId = piscinas[i].id;
            break;
          }
        }
      }
      if (!e.laneId) {
        var melhor = null;
        for (var j = 0; j < raias.length; j++) {
          var rb = raias[j].bounds;
          if (c.x >= rb.x && c.x <= rb.x + rb.width && c.y >= rb.y && c.y <= rb.y + rb.height) {
            if (!melhor || rb.height < melhor.bounds.height) melhor = raias[j];
          }
        }
        if (melhor) e.laneId = melhor.id;
      }
    });

    // participante de cada raia
    raias.forEach(function (r) {
      if (r.participantId) return;
      var c = SB.util.centro(r.bounds);
      for (var i = 0; i < piscinas.length; i++) {
        var b = piscinas[i].bounds;
        if (c.x >= b.x && c.x <= b.x + b.width && c.y >= b.y && c.y <= b.y + b.height) {
          r.participantId = piscinas[i].id;
          return;
        }
      }
    });
  }

  /** Recalcula listas de entrada/saida de cada no. */
  function indexar(m) {
    m.ordem.forEach(function (id) {
      m.elementos[id].entradas = [];
      m.elementos[id].saidas = [];
      m.elementos[id].bordas = [];
    });
    m.ordemFluxos.forEach(function (fid) {
      var f = m.fluxos[fid];
      if (f.tipo !== 'sequenceFlow') return;
      var o = m.elementos[f.origem];
      var a = m.elementos[f.alvo];
      if (o) o.saidas.push(fid);
      if (a) a.entradas.push(fid);
    });
    m.ordem.forEach(function (id) {
      var e = m.elementos[id];
      if (e.tipo === 'boundaryEvent' && e.attachedToRef && m.elementos[e.attachedToRef]) {
        m.elementos[e.attachedToRef].bordas.push(id);
      }
    });
    return m;
  }

  /* ---------------------------------------------------------------- */

  function analisar(xmlTexto) {
    var doc = new DOMParser().parseFromString(xmlTexto, 'application/xml');
    var erro = doc.getElementsByTagName('parsererror')[0];
    if (erro) throw new Error('XML invalido: ' + (erro.textContent || '').split('\n')[0]);

    var def = doc.documentElement;
    if (!def || def.localName !== 'definitions') {
      throw new Error('Raiz esperada <definitions> do BPMN 2.0, encontrada <' + (def ? def.localName : '?') + '>.');
    }

    var m = novoModelo();
    m.definitionsId = attr(def, 'id', 'Definitions_1');
    m.targetNamespace = attr(def, 'targetNamespace', m.targetNamespace);
    m.exporter = attr(def, 'exporter', m.exporter);
    m.exporterVersion = attr(def, 'exporterVersion', m.exporterVersion);

    // 1) colaboracao (participantes e fluxos de mensagem)
    var colab = primeiroFilho(def, 'collaboration');
    var mapaProcParticipante = {};
    if (colab) {
      m.colaboracao = { id: attr(colab, 'id', 'Collaboration_1'), nome: attr(colab, 'name', '') };
      filhos(colab, 'participant').forEach(function (p) {
        var e = addElemento(m, {
          id: attr(p, 'id', SB.util.uid('Participant')),
          tipo: 'participant',
          nome: attr(p, 'name', ''),
          processRef: attr(p, 'processRef', null),
          definicoes: [],
          bounds: null,
          isHorizontal: true
        });
        if (e.processRef) mapaProcParticipante[e.processRef] = e.id;
      });
      filhos(colab, 'messageFlow').forEach(function (mf) {
        addFluxo(m, {
          id: attr(mf, 'id', SB.util.uid('MsgFlow')),
          tipo: 'messageFlow',
          nome: attr(mf, 'name', ''),
          origem: attr(mf, 'sourceRef', null),
          alvo: attr(mf, 'targetRef', null),
          pai: m.colaboracao.id,
          waypoints: []
        });
      });
    }

    // 2) processos
    filhos(def, 'process').forEach(function (p) {
      var pid = attr(p, 'id', null);
      lerProcesso(m, p, pid ? mapaProcParticipante[pid] || null : null);
    });

    // 3) diagrama (DI)
    var diag = primeiroFilho(def, 'BPMNDiagram');
    if (diag) lerDI(m, diag);

    if (!m.planoElemento) {
      m.planoElemento = m.colaboracao ? m.colaboracao.id : (m.ordemProcessos[0] || null);
    }
    m.nome = (m.processos[m.ordemProcessos[0]] && m.processos[m.ordemProcessos[0]].nome) ||
      (m.colaboracao && m.colaboracao.nome) || 'Diagrama BPMN';

    inferirContainers(m);
    indexar(m);

    var semGeometria = m.ordem.filter(function (id) { return !m.elementos[id].bounds; });
    if (semGeometria.length) {
      m.avisosLeitura.push(semGeometria.length + ' elemento(s) sem geometria (BPMNShape). Layout automatico aplicado.');
    }
    return m;
  }

  SB.parser = {
    analisar: analisar,
    novoModelo: novoModelo,
    indexar: indexar,
    addElemento: addElemento,
    addFluxo: addFluxo,
    TIPOS_NO: TIPOS_NO,
    DEFS_EVENTO: DEFS_EVENTO
  };
})(window);
