/*
 * Validador de conformidade com o BPMN 2.0.2.
 * Cada regra cita a clausula da especificacao OMG formal/13-12-09 que a
 * sustenta, para servir tambem como material de apoio didatico.
 */
(function (global) {
  'use strict';
  var SB = global.SB || (global.SB = {});
  var spec = SB.spec;

  function validar(m) {
    var achados = [];
    function add(sev, regra, msg, id, ref) {
      achados.push({ severidade: sev, regra: regra, mensagem: msg, elementoId: id || null, referencia: ref || '' });
    }

    var els = m.ordem.map(function (id) { return m.elementos[id]; });
    var nomeDe = function (id) {
      var e = m.elementos[id];
      if (!e) return id;
      return '"' + (e.nome || spec.rotulo(e.tipo)) + '"';
    };
    var participanteDe = function (id) {
      var e = m.elementos[id];
      if (!e) return null;
      if (e.tipo === 'participant') return e.id;
      return e.participantId || null;
    };

    /* ---------------------------------------------- IDs duplicados */
    var vistos = {};
    m.ordem.concat(m.ordemFluxos).forEach(function (id) {
      if (vistos[id]) add('erro', 'id-duplicado', 'Identificador repetido: ' + id, id, 'BPMN 8.3.1');
      vistos[id] = true;
    });

    /* ---------------------------------------------- eventos de inicio/fim */
    m.ordemProcessos.forEach(function (pid) {
      var doProcesso = els.filter(function (e) { return e.pai === pid; });
      if (!doProcesso.length) return;
      var inicios = doProcesso.filter(function (e) { return e.tipo === 'startEvent'; });
      var fins = doProcesso.filter(function (e) { return e.tipo === 'endEvent'; });
      var proc = m.processos[pid];
      var rotuloProc = proc && proc.nome ? '"' + proc.nome + '"' : pid;
      if (!inicios.length) {
        add('erro', 'sem-inicio', 'O processo ' + rotuloProc + ' nao possui evento de inicio. A simulacao nao tem por onde comecar.', pid, 'BPMN 10.5.2');
      }
      if (!fins.length) {
        add('aviso', 'sem-fim', 'O processo ' + rotuloProc + ' nao possui evento de fim. Recomenda-se encerrar todos os caminhos explicitamente.', pid, 'BPMN 10.5.3');
      }
    });

    /* ---------------------------------------------- por elemento */
    els.forEach(function (e) {
      var cat = spec.categoria(e.tipo);
      var ent = (e.entradas || []).length;
      var sai = (e.saidas || []).length;

      if (cat === 'evento') {
        // definicao de evento permitida?
        var permitidas = spec.DEFINICOES_PERMITIDAS[e.tipo] || [];
        (e.definicoes || []).forEach(function (d) {
          if (permitidas.length && permitidas.indexOf(d) === -1) {
            add('erro', 'definicao-invalida', 'O gatilho "' + ((spec.DEFINICOES[d] || {}).rotulo || d) + '" nao e permitido em ' +
              spec.rotulo(e.tipo).toLowerCase() + ' ' + nomeDe(e.id) + '.', e.id, 'BPMN 10.5.2 a 10.5.5');
          }
        });

        if (e.tipo === 'startEvent' && ent > 0) {
          add('erro', 'inicio-com-entrada', 'Evento de inicio ' + nomeDe(e.id) + ' nao pode receber fluxo de sequencia.', e.id, 'BPMN Tabela 7.3');
        }
        if (e.tipo === 'startEvent' && sai === 0) {
          add('erro', 'inicio-sem-saida', 'Evento de inicio ' + nomeDe(e.id) + ' precisa de um fluxo de sequencia de saida.', e.id, 'BPMN 10.5.2');
        }
        if (e.tipo === 'endEvent' && sai > 0) {
          add('erro', 'fim-com-saida', 'Evento de fim ' + nomeDe(e.id) + ' nao pode ter fluxo de sequencia de saida.', e.id, 'BPMN Tabela 7.3');
        }
        if (e.tipo === 'endEvent' && ent === 0) {
          add('erro', 'fim-sem-entrada', 'Evento de fim ' + nomeDe(e.id) + ' esta desconectado.', e.id, 'BPMN 10.5.3');
        }
        if (e.tipo === 'boundaryEvent') {
          var host = m.elementos[e.attachedToRef];
          if (!host) {
            add('erro', 'borda-sem-host', 'Evento de borda ' + nomeDe(e.id) + ' nao esta anexado a nenhuma atividade.', e.id, 'BPMN 10.5.4');
          } else if (!spec.ehAtividade(host.tipo)) {
            add('erro', 'borda-host-invalido', 'Evento de borda ' + nomeDe(e.id) + ' so pode ser anexado a uma atividade.', e.id, 'BPMN 10.5.4');
          }
          if (ent > 0) {
            add('erro', 'borda-com-entrada', 'Evento de borda ' + nomeDe(e.id) + ' nao pode receber fluxo de sequencia.', e.id, 'BPMN Tabela 7.3');
          }
          if (sai === 0) {
            add('aviso', 'borda-sem-saida', 'Evento de borda ' + nomeDe(e.id) + ' sem fluxo de saida: o caminho de excecao nao leva a lugar nenhum.', e.id, 'BPMN 10.5.4');
          }
        }
        if ((e.tipo === 'intermediateCatchEvent' || e.tipo === 'intermediateThrowEvent') && (ent === 0 || sai === 0)) {
          add('aviso', 'evento-desconectado', 'Evento intermediario ' + nomeDe(e.id) + ' deve ter fluxo de entrada e de saida.', e.id, 'BPMN Tabela 7.3');
        }
      }

      if (cat === 'atividade') {
        if (ent === 0) add('aviso', 'atividade-sem-entrada', 'Atividade ' + nomeDe(e.id) + ' nao recebe nenhum fluxo de sequencia.', e.id, 'BPMN 10.3');
        if (sai === 0) add('aviso', 'atividade-sem-saida', 'Atividade ' + nomeDe(e.id) + ' nao tem continuidade no fluxo.', e.id, 'BPMN 10.3');
        if (sai > 1) {
          add('aviso', 'split-implicito', 'Atividade ' + nomeDe(e.id) + ' tem ' + sai + ' fluxos de saida (divisao implicita). Prefira um gateway explicito para deixar a decisao clara.', e.id, 'BPMN 10.6.1');
        }
        if (!e.nome || !e.nome.trim()) {
          add('dica', 'atividade-sem-nome', 'Atividade sem nome. Use o padrao "verbo + substantivo" (ex.: "Emitir nota fiscal").', e.id, 'Boas praticas de modelagem');
        } else if (e.nome.trim().split(/\s+/).length < 2) {
          add('dica', 'nome-curto', 'O nome ' + nomeDe(e.id) + ' e muito curto. Recomenda-se "verbo + substantivo".', e.id, 'Boas praticas de modelagem');
        }
      }

      if (cat === 'gateway') {
        if (ent === 0 || sai === 0) {
          add('erro', 'gateway-desconectado', 'Gateway ' + nomeDe(e.id) + ' precisa de pelo menos um fluxo de entrada e um de saida.', e.id, 'BPMN 10.6.1');
        }
        if (ent === 1 && sai === 1) {
          add('aviso', 'gateway-inutil', 'Gateway ' + nomeDe(e.id) + ' tem apenas uma entrada e uma saida; ele nao decide nem sincroniza nada.', e.id, 'BPMN 10.6.1');
        }
        if ((e.tipo === 'exclusiveGateway' || e.tipo === 'inclusiveGateway') && sai > 1) {
          var semCondicao = (e.saidas || []).filter(function (fid) {
            var f = m.fluxos[fid];
            return !f.condicao && e.padrao !== fid;
          });
          if (semCondicao.length && !e.padrao) {
            add('aviso', 'sem-condicao', 'Gateway ' + nomeDe(e.id) + ' divergente sem condicoes em todos os caminhos e sem fluxo padrao. Se nenhuma condicao for verdadeira ocorre excecao em tempo de execucao.', e.id, 'BPMN 10.6.2 / 10.6.3');
          }
          if (!e.nome || !e.nome.trim()) {
            add('dica', 'gateway-sem-pergunta', 'Gateway divergente sem rotulo. Nomeie-o como uma pergunta (ex.: "Credito aprovado?").', e.id, 'BPMN 10.6.2');
          }
        }
        if (e.tipo === 'eventBasedGateway') {
          if (sai < 2) {
            add('erro', 'evento-gateway-saidas', 'Gateway baseado em evento ' + nomeDe(e.id) + ' precisa de duas ou mais saidas.', e.id, 'BPMN 10.6.6');
          }
          var temReceive = false, temMsgEvento = false;
          (e.saidas || []).forEach(function (fid) {
            var f = m.fluxos[fid];
            if (f.condicao) {
              add('erro', 'evento-gateway-condicao', 'Fluxos que saem de um gateway baseado em evento nao podem ter condicao.', fid, 'BPMN 10.6.6');
            }
            var alvo = m.elementos[f.alvo];
            if (!alvo) return;
            if (alvo.tipo === 'receiveTask') temReceive = true;
            else if (alvo.tipo === 'intermediateCatchEvent') {
              if (spec.temDef(alvo.definicoes, 'message')) temMsgEvento = true;
            } else {
              add('erro', 'evento-gateway-alvo', 'O alvo ' + nomeDe(alvo.id) + ' nao e valido apos um gateway baseado em evento (use evento intermediario de captura ou tarefa de recebimento).', alvo.id, 'BPMN 10.6.6');
            }
          });
          if (temReceive && temMsgEvento) {
            add('erro', 'evento-gateway-mistura', 'Gateway baseado em evento ' + nomeDe(e.id) + ' mistura tarefas de recebimento com eventos de mensagem; escolha apenas um dos dois.', e.id, 'BPMN 10.6.6');
          }
        }
      }

      if (e.tipo === 'lane') {
        var conteudo = els.filter(function (c) { return c.laneId === e.id; });
        if (!conteudo.length) {
          add('dica', 'raia-vazia', 'A raia "' + (e.nome || e.id) + '" esta vazia.', e.id, 'BPMN 10.8');
        }
        if (!e.nome) add('dica', 'raia-sem-nome', 'Raia sem nome: identifique o papel/area responsavel.', e.id, 'BPMN 10.8');
      }
      if (e.tipo === 'participant' && !e.nome) {
        add('aviso', 'piscina-sem-nome', 'Piscina sem nome: identifique o participante.', e.id, 'BPMN 9.3');
      }
    });

    /* ---------------------------------------------- fluxos */
    m.ordemFluxos.forEach(function (fid) {
      var f = m.fluxos[fid];
      var o = m.elementos[f.origem];
      var a = m.elementos[f.alvo];

      if (!o) add('erro', 'origem-inexistente', 'O fluxo ' + fid + ' aponta para uma origem inexistente (' + f.origem + ').', fid, 'BPMN 8.4.13');
      if (!a) add('erro', 'alvo-inexistente', 'O fluxo ' + fid + ' aponta para um alvo inexistente (' + f.alvo + ').', fid, 'BPMN 8.4.13');
      if (!o || !a) return;

      if (f.tipo === 'sequenceFlow') {
        if (!spec.podeSerOrigemSequencia(o.tipo)) {
          add('erro', 'origem-invalida', spec.rotulo(o.tipo) + ' ' + nomeDe(o.id) + ' nao pode ser origem de fluxo de sequencia.', fid, 'BPMN Tabela 7.3');
        }
        if (!spec.podeSerAlvoSequencia(a.tipo)) {
          add('erro', 'alvo-invalido', spec.rotulo(a.tipo) + ' ' + nomeDe(a.id) + ' nao pode ser alvo de fluxo de sequencia.', fid, 'BPMN Tabela 7.3');
        }
        var pa = participanteDe(o.id), pb = participanteDe(a.id);
        if (pa && pb && pa !== pb) {
          add('erro', 'sequencia-cruza-piscina', 'Fluxo de sequencia entre piscinas diferentes (' + nomeDe(pa) + ' -> ' + nomeDe(pb) + '). Use fluxo de mensagem.', fid, 'BPMN 7.6.1');
        }
        if (o.pai && a.pai && o.pai !== a.pai) {
          var paiO = m.elementos[o.pai], paiA = m.elementos[a.pai];
          var dentroSub = (paiO && spec.ehAtividade(paiO.tipo)) || (paiA && spec.ehAtividade(paiA.tipo));
          if (dentroSub) {
            add('erro', 'sequencia-cruza-subprocesso', 'Fluxo de sequencia atravessa a fronteira de um subprocesso.', fid, 'BPMN 7.6.1');
          }
        }
      }

      if (f.tipo === 'messageFlow') {
        var ma = participanteDe(o.id), mb = participanteDe(a.id);
        if (ma && mb && ma === mb) {
          add('erro', 'mensagem-mesma-piscina', 'Fluxo de mensagem dentro da mesma piscina (' + nomeDe(ma) + '). Mensagens so podem cruzar piscinas.', fid, 'BPMN 7.6.2');
        }
        if (!spec.podeSerOrigemMensagem(o.tipo, o.definicoes)) {
          add('erro', 'mensagem-origem-invalida', spec.rotulo(o.tipo) + ' ' + nomeDe(o.id) + ' nao pode enviar mensagem. Use piscina, atividade, evento intermediario de disparo de mensagem ou evento de fim de mensagem.', fid, 'BPMN Tabela 7.4');
        }
        if (!spec.podeSerAlvoMensagem(a.tipo, a.definicoes)) {
          add('erro', 'mensagem-alvo-invalido', spec.rotulo(a.tipo) + ' ' + nomeDe(a.id) + ' nao pode receber mensagem. Use piscina, atividade, evento de inicio de mensagem ou evento intermediario de captura de mensagem.', fid, 'BPMN Tabela 7.4');
        }
        if (!f.nome) {
          add('dica', 'mensagem-sem-nome', 'Fluxo de mensagem sem rotulo: nomeie a mensagem trocada.', fid, 'BPMN 9.4');
        }
      }
    });

    /* ---------------------------------------------- alcancabilidade */
    var inicios = els.filter(function (e) { return e.tipo === 'startEvent'; });
    if (inicios.length) {
      var alcancados = {};
      var pilha = inicios.map(function (e) { return e.id; });
      while (pilha.length) {
        var atual = pilha.pop();
        if (alcancados[atual]) continue;
        alcancados[atual] = true;
        var el = m.elementos[atual];
        if (!el) continue;
        (el.saidas || []).forEach(function (fid) { pilha.push(m.fluxos[fid].alvo); });
        (el.bordas || []).forEach(function (bid) { pilha.push(bid); });
      }
      els.forEach(function (e) {
        if (['evento', 'atividade', 'gateway'].indexOf(spec.categoria(e.tipo)) === -1) return;
        if (e.tipo === 'startEvent') return;
        if (!alcancados[e.id]) {
          add('aviso', 'inalcancavel', nomeDe(e.id) + ' nao e alcancavel a partir de nenhum evento de inicio.', e.id, 'BPMN 10.9');
        }
      });
    }

    var ordemSev = { erro: 0, aviso: 1, dica: 2 };
    achados.sort(function (a, b) { return ordemSev[a.severidade] - ordemSev[b.severidade]; });
    return achados;
  }

  SB.validador = { validar: validar };
})(window);
