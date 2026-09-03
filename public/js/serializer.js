/*
 * Gerador de XML BPMN 2.0 (modelo interno -> arquivo .bpmn).
 * Produz <bpmn:definitions> com colaboracao, processos, raias, elementos
 * de fluxo, artefatos e o diagrama de intercambio (BPMN DI), de modo que o
 * arquivo abra em qualquer ferramenta compativel (Camunda, bpmn.io, Bizagi).
 */
(function (global) {
  'use strict';
  var SB = global.SB || (global.SB = {});
  var u = SB.util;
  var spec = SB.spec;

  var NS = [
    'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
    'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"',
    'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"',
    'xmlns:di="http://www.omg.org/spec/DD/20100524/DI"',
    'xmlns:sim="http://simulador-bpmn/schema/1.0"',
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
  ].join(' ');

  var DEF_TAG = {
    message: 'messageEventDefinition',
    timer: 'timerEventDefinition',
    error: 'errorEventDefinition',
    escalation: 'escalationEventDefinition',
    cancel: 'cancelEventDefinition',
    compensate: 'compensateEventDefinition',
    conditional: 'conditionalEventDefinition',
    link: 'linkEventDefinition',
    signal: 'signalEventDefinition',
    terminate: 'terminateEventDefinition'
  };

  function ancorar(e, alvo) {
    var cat = spec.categoria(e.tipo);
    if (cat === 'evento') return u.ancoraCirculo(e.bounds, alvo);
    if (cat === 'gateway') return u.ancoraLosango(e.bounds, alvo);
    return u.ancoraRetangulo(e.bounds, alvo);
  }

  function pontosDoFluxo(m, f) {
    if (f.waypoints && f.waypoints.length >= 2) return f.waypoints;
    var o = m.elementos[f.origem];
    var a = m.elementos[f.alvo];
    if (!o || !a || !o.bounds || !a.bounds) return null;
    var pts = u.roteamentoOrtogonal(o.bounds, a.bounds);
    pts[0] = ancorar(o, pts[1] || u.centro(a.bounds));
    pts[pts.length - 1] = ancorar(a, pts[pts.length - 2] || u.centro(o.bounds));
    return pts;
  }

  function attrSim(el) {
    var s = el.sim || {};
    var partes = [];
    ['duracaoMin', 'duracaoMax', 'custo', 'probabilidade'].forEach(function (k) {
      if (s[k] !== undefined && s[k] !== null && s[k] !== '' && !isNaN(s[k])) partes.push(k + '="' + s[k] + '"');
    });
    if (s.recurso) partes.push('recurso="' + u.escapeXml(s.recurso) + '"');
    if (!partes.length) return '';
    return '\n      <bpmn:extensionElements>\n        <sim:parametros ' + partes.join(' ') + ' />\n      </bpmn:extensionElements>';
  }

  function serializarNo(m, e, ind) {
    var i = ind;
    var tag = 'bpmn:' + e.tipo;
    var attrs = ' id="' + u.escapeXml(e.id) + '"';
    if (e.nome) attrs += ' name="' + u.escapeXml(e.nome) + '"';
    if (e.tipo === 'boundaryEvent') {
      attrs += ' attachedToRef="' + u.escapeXml(e.attachedToRef || '') + '"';
      if (e.cancelActivity === false) attrs += ' cancelActivity="false"';
    }
    if (e.tipo === 'callActivity' && e.calledElement) attrs += ' calledElement="' + u.escapeXml(e.calledElement) + '"';
    if (e.padrao) attrs += ' default="' + u.escapeXml(e.padrao) + '"';
    if (e.triggeredByEvent) attrs += ' triggeredByEvent="true"';
    if (e.forCompensation) attrs += ' isForCompensation="true"';

    var corpo = '';
    corpo += attrSim(e);
    if (e.documentacao) corpo += '\n' + i + '  <bpmn:documentation>' + u.escapeXml(e.documentacao) + '</bpmn:documentation>';
    (e.entradas || []).forEach(function (fid) { corpo += '\n' + i + '  <bpmn:incoming>' + u.escapeXml(fid) + '</bpmn:incoming>'; });
    (e.saidas || []).forEach(function (fid) { corpo += '\n' + i + '  <bpmn:outgoing>' + u.escapeXml(fid) + '</bpmn:outgoing>'; });

    if (spec.ehEvento(e.tipo)) {
      (e.definicoes || []).forEach(function (d) {
        if (d === 'none' || !DEF_TAG[d]) return;
        corpo += '\n' + i + '  <bpmn:' + DEF_TAG[d] + ' id="' + u.escapeXml(d + '_' + e.id) + '" />';
      });
    }
    if (e.loop === 'standard') corpo += '\n' + i + '  <bpmn:standardLoopCharacteristics />';
    if (e.loop === 'paralelo') corpo += '\n' + i + '  <bpmn:multiInstanceLoopCharacteristics isSequential="false" />';
    if (e.loop === 'sequencial') corpo += '\n' + i + '  <bpmn:multiInstanceLoopCharacteristics isSequential="true" />';

    // subprocesso: elementos filhos
    if (e.tipo === 'subProcess' || e.tipo === 'transaction' || e.tipo === 'adHocSubProcess') {
      m.ordem.forEach(function (id) {
        var c = m.elementos[id];
        if (c.pai !== e.id) return;
        if (['evento', 'atividade', 'gateway'].indexOf(spec.categoria(c.tipo)) === -1) return;
        corpo += '\n' + serializarNo(m, c, i + '  ');
      });
      m.ordemFluxos.forEach(function (fid) {
        var f = m.fluxos[fid];
        if (f.pai !== e.id || f.tipo !== 'sequenceFlow') return;
        corpo += '\n' + serializarFluxo(f, i + '  ');
      });
    }

    if (!corpo) return i + '<' + tag + attrs + ' />';
    return i + '<' + tag + attrs + '>' + corpo + '\n' + i + '</' + tag + '>';
  }

  function serializarFluxo(f, ind) {
    var attrs = ' id="' + u.escapeXml(f.id) + '"';
    if (f.nome) attrs += ' name="' + u.escapeXml(f.nome) + '"';
    attrs += ' sourceRef="' + u.escapeXml(f.origem) + '" targetRef="' + u.escapeXml(f.alvo) + '"';
    var corpo = attrSim(f);
    if (f.condicao) {
      corpo += '\n' + ind + '  <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">' +
        u.escapeXml(f.condicao) + '</bpmn:conditionExpression>';
    }
    if (!corpo) return ind + '<bpmn:sequenceFlow' + attrs + ' />';
    return ind + '<bpmn:sequenceFlow' + attrs + '>' + corpo + '\n' + ind + '</bpmn:sequenceFlow>';
  }

  function gerar(m) {
    var L = [];
    L.push('<?xml version="1.0" encoding="UTF-8"?>');
    L.push('<bpmn:definitions ' + NS + ' id="' + u.escapeXml(m.definitionsId || 'Definitions_1') + '"' +
      ' targetNamespace="' + u.escapeXml(m.targetNamespace || 'http://bpmn.io/schema/bpmn') + '"' +
      ' exporter="Simulador BPMN" exporterVersion="1.0.0">');

    var participantes = m.ordem.map(function (id) { return m.elementos[id]; })
      .filter(function (e) { return e.tipo === 'participant'; });
    var fluxosMensagem = m.ordemFluxos.map(function (id) { return m.fluxos[id]; })
      .filter(function (f) { return f.tipo === 'messageFlow'; });

    /* ---- colaboracao ---- */
    if (participantes.length || fluxosMensagem.length) {
      var colabId = (m.colaboracao && m.colaboracao.id) || 'Collaboration_1';
      L.push('  <bpmn:collaboration id="' + u.escapeXml(colabId) + '">');
      participantes.forEach(function (p) {
        L.push('    <bpmn:participant id="' + u.escapeXml(p.id) + '"' +
          (p.nome ? ' name="' + u.escapeXml(p.nome) + '"' : '') +
          (p.processRef ? ' processRef="' + u.escapeXml(p.processRef) + '"' : '') + ' />');
      });
      fluxosMensagem.forEach(function (f) {
        L.push('    <bpmn:messageFlow id="' + u.escapeXml(f.id) + '"' +
          (f.nome ? ' name="' + u.escapeXml(f.nome) + '"' : '') +
          ' sourceRef="' + u.escapeXml(f.origem) + '" targetRef="' + u.escapeXml(f.alvo) + '" />');
      });
      L.push('  </bpmn:collaboration>');
    }

    /* ---- processos ---- */
    m.ordemProcessos.forEach(function (pid) {
      var p = m.processos[pid];
      L.push('  <bpmn:process id="' + u.escapeXml(pid) + '"' +
        (p.nome ? ' name="' + u.escapeXml(p.nome) + '"' : '') +
        ' isExecutable="' + (p.isExecutable ? 'true' : 'false') + '">');

      var raias = m.ordem.map(function (id) { return m.elementos[id]; })
        .filter(function (e) { return e.tipo === 'lane' && e.pai === pid; });
      if (raias.length) {
        L.push('    <bpmn:laneSet id="LaneSet_' + u.escapeXml(pid) + '">');
        raias.forEach(function (l) {
          L.push('      <bpmn:lane id="' + u.escapeXml(l.id) + '"' + (l.nome ? ' name="' + u.escapeXml(l.nome) + '"' : '') + '>');
          m.ordem.forEach(function (id) {
            var c = m.elementos[id];
            if (c.laneId !== l.id) return;
            if (['evento', 'atividade', 'gateway'].indexOf(spec.categoria(c.tipo)) === -1) return;
            if (c.pai !== pid) return;
            L.push('        <bpmn:flowNodeRef>' + u.escapeXml(c.id) + '</bpmn:flowNodeRef>');
          });
          L.push('      </bpmn:lane>');
        });
        L.push('    </bpmn:laneSet>');
      }

      m.ordem.forEach(function (id) {
        var e = m.elementos[id];
        if (e.pai !== pid) return;
        if (['evento', 'atividade', 'gateway'].indexOf(spec.categoria(e.tipo)) === -1) return;
        L.push(serializarNo(m, e, '    '));
      });

      m.ordem.forEach(function (id) {
        var e = m.elementos[id];
        if (e.pai !== pid) return;
        if (e.tipo === 'dataObjectReference') {
          L.push('    <bpmn:dataObjectReference id="' + u.escapeXml(e.id) + '"' + (e.nome ? ' name="' + u.escapeXml(e.nome) + '"' : '') + ' />');
        } else if (e.tipo === 'dataStoreReference') {
          L.push('    <bpmn:dataStoreReference id="' + u.escapeXml(e.id) + '"' + (e.nome ? ' name="' + u.escapeXml(e.nome) + '"' : '') + ' />');
        }
      });

      m.ordemFluxos.forEach(function (fid) {
        var f = m.fluxos[fid];
        if (f.pai !== pid || f.tipo !== 'sequenceFlow') return;
        L.push(serializarFluxo(f, '    '));
      });

      m.ordem.forEach(function (id) {
        var e = m.elementos[id];
        if (e.pai !== pid) return;
        if (e.tipo === 'textAnnotation') {
          L.push('    <bpmn:textAnnotation id="' + u.escapeXml(e.id) + '">');
          L.push('      <bpmn:text>' + u.escapeXml(e.texto || '') + '</bpmn:text>');
          L.push('    </bpmn:textAnnotation>');
        } else if (e.tipo === 'group') {
          L.push('    <bpmn:group id="' + u.escapeXml(e.id) + '"' + (e.nome ? ' categoryValueRef="' + u.escapeXml(e.nome) + '"' : '') + ' />');
        }
      });
      m.ordemFluxos.forEach(function (fid) {
        var f = m.fluxos[fid];
        if (f.pai !== pid || f.tipo !== 'association') return;
        L.push('    <bpmn:association id="' + u.escapeXml(f.id) + '" sourceRef="' + u.escapeXml(f.origem) +
          '" targetRef="' + u.escapeXml(f.alvo) + '" />');
      });

      L.push('  </bpmn:process>');
    });

    /* ---- diagrama (DI) ---- */
    var planoEl = m.planoElemento ||
      ((m.colaboracao && m.colaboracao.id) || m.ordemProcessos[0] || 'Process_1');
    L.push('  <bpmndi:BPMNDiagram id="' + u.escapeXml(m.diagramaId || 'BPMNDiagram_1') + '">');
    L.push('    <bpmndi:BPMNPlane id="' + u.escapeXml(m.planoId || 'BPMNPlane_1') + '" bpmnElement="' + u.escapeXml(planoEl) + '">');

    m.ordem.forEach(function (id) {
      var e = m.elementos[id];
      if (!e.bounds) return;
      var extra = '';
      if (e.tipo === 'participant' || e.tipo === 'lane') extra += ' isHorizontal="true"';
      if ((e.tipo === 'subProcess' || e.tipo === 'transaction') && e.expandido === false) extra += ' isExpanded="false"';
      var precisaLabel = ['evento', 'gateway', 'dado'].indexOf(spec.categoria(e.tipo)) !== -1 && e.nome;
      L.push('      <bpmndi:BPMNShape id="Shape_' + u.escapeXml(e.id) + '" bpmnElement="' + u.escapeXml(e.id) + '"' + extra + '>');
      L.push('        <dc:Bounds x="' + Math.round(e.bounds.x) + '" y="' + Math.round(e.bounds.y) +
        '" width="' + Math.round(e.bounds.width) + '" height="' + Math.round(e.bounds.height) + '" />');
      if (precisaLabel) {
        var lb = e.labelBounds || {
          x: e.bounds.x + e.bounds.width / 2 - 45,
          y: e.bounds.y + e.bounds.height + 4,
          width: 90, height: 27
        };
        L.push('        <bpmndi:BPMNLabel>');
        L.push('          <dc:Bounds x="' + Math.round(lb.x) + '" y="' + Math.round(lb.y) +
          '" width="' + Math.round(lb.width) + '" height="' + Math.round(lb.height) + '" />');
        L.push('        </bpmndi:BPMNLabel>');
      }
      L.push('      </bpmndi:BPMNShape>');
    });

    m.ordemFluxos.forEach(function (fid) {
      var f = m.fluxos[fid];
      var pts = pontosDoFluxo(m, f);
      if (!pts) return;
      L.push('      <bpmndi:BPMNEdge id="Edge_' + u.escapeXml(f.id) + '" bpmnElement="' + u.escapeXml(f.id) + '">');
      pts.forEach(function (p) {
        L.push('        <di:waypoint x="' + Math.round(p.x) + '" y="' + Math.round(p.y) + '" />');
      });
      if (f.nome) {
        var m2 = u.pontoNoCaminho(pts, 0.5);
        var lb2 = f.labelBounds || { x: m2.x - 45, y: m2.y - 22, width: 90, height: 18 };
        L.push('        <bpmndi:BPMNLabel>');
        L.push('          <dc:Bounds x="' + Math.round(lb2.x) + '" y="' + Math.round(lb2.y) +
          '" width="' + Math.round(lb2.width) + '" height="' + Math.round(lb2.height) + '" />');
        L.push('        </bpmndi:BPMNLabel>');
      }
      L.push('      </bpmndi:BPMNEdge>');
    });

    L.push('    </bpmndi:BPMNPlane>');
    L.push('  </bpmndi:BPMNDiagram>');
    L.push('</bpmn:definitions>');
    return L.join('\n');
  }

  SB.serializer = { gerar: gerar, pontosDoFluxo: pontosDoFluxo };
})(window);
