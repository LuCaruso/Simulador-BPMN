/*
 * Editor de diagramas: criacao, movimentacao, redimensionamento, conexao
 * e exclusao de elementos, com validacao das regras de conexao do BPMN
 * (clausula 7.6) no momento de ligar dois elementos.
 */
(function (global) {
  'use strict';
  var SB = global.SB || (global.SB = {});
  var u = SB.util;
  var spec = SB.spec;

  var GRADE = 10;

  function Editor(renderer, app) {
    this.r = renderer;
    this.app = app;
    this.modo = 'selecionar';
    this.tipoNovo = null;
    this.defNovo = null;
    this.selecao = [];
    this.arrasto = null;
    this.conexao = null;
    this.historico = [];
    this.futuro = [];
    this.habilitado = true;
    this._ligarEventos();
  }

  Editor.prototype.modelo = function () { return this.app.modelo; };

  /* ---------------------------------------------------- historico */

  Editor.prototype.snapshot = function () {
    var m = this.modelo();
    if (!m) return;
    this.historico.push(JSON.stringify(m));
    if (this.historico.length > 60) this.historico.shift();
    this.futuro.length = 0;
    this.app.atualizarBotoesHistorico();
  };

  Editor.prototype.desfazer = function () {
    if (!this.historico.length) return;
    this.futuro.push(JSON.stringify(this.modelo()));
    var m = JSON.parse(this.historico.pop());
    this.app.definirModelo(SB.parser.indexar(m), { semSnapshot: true });
    this.app.atualizarBotoesHistorico();
  };

  Editor.prototype.refazer = function () {
    if (!this.futuro.length) return;
    this.historico.push(JSON.stringify(this.modelo()));
    var m = JSON.parse(this.futuro.pop());
    this.app.definirModelo(SB.parser.indexar(m), { semSnapshot: true });
    this.app.atualizarBotoesHistorico();
  };

  /* ------------------------------------------------------- modos */

  Editor.prototype.definirModo = function (modo, tipo, def) {
    this.modo = modo;
    this.tipoNovo = tipo || null;
    this.defNovo = def || null;
    this.conexao = null;
    this.r.svg.setAttribute('data-modo', modo);
    this.app.atualizarBarraModo();
    this.desenharAuxiliares();
  };

  /* -------------------------------------------------- eventos DOM */

  Editor.prototype._ligarEventos = function () {
    var self = this;
    var svg = this.r.svg;

    this.r.aoSelecionar = function (id, ev) { self._mousedownElemento(id, ev); };

    svg.addEventListener('mousedown', function (ev) {
      if (ev.target.closest && ev.target.closest('.bpmn-no, .bpmn-fluxo, .alca, .bpmn-piscina, .bpmn-raia, .bpmn-grupo')) return;
      if (self.modo.indexOf('criar') === 0) {
        var p = self.r.paraDiagrama(ev.clientX, ev.clientY);
        self.criarNoPonto(p);
        return;
      }
      // pan
      self.arrasto = { tipo: 'pan', x0: ev.clientX, y0: ev.clientY, tx: self.r.tx, ty: self.r.ty };
      self.selecionar([]);
    });

    window.addEventListener('mousemove', function (ev) { self._mousemove(ev); });
    window.addEventListener('mouseup', function (ev) { self._mouseup(ev); });

    svg.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var r = svg.getBoundingClientRect();
      self.r.zoom(ev.deltaY < 0 ? 1.12 : 1 / 1.12, ev.clientX - r.left, ev.clientY - r.top);
      self.desenharAuxiliares();
    }, { passive: false });

    svg.addEventListener('dblclick', function (ev) {
      var alvo = ev.target.closest && ev.target.closest('[data-id]');
      if (!alvo) return;
      var id = alvo.getAttribute('data-id');
      self.app.focarNomeNasPropriedades(id);
    });

    window.addEventListener('keydown', function (ev) {
      if (/input|textarea|select/i.test((ev.target.tagName || ''))) return;
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (self.selecao.length) { ev.preventDefault(); self.excluirSelecao(); }
      } else if (ev.key === 'Escape') {
        self.definirModo('selecionar');
        self.selecionar([]);
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) self.refazer(); else self.desfazer();
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') {
        ev.preventDefault(); self.refazer();
      }
    });
  };

  Editor.prototype._mousedownElemento = function (id, ev) {
    var m = this.modelo();
    if (!m) return;
    var el = m.elementos[id];

    if (this.modo === 'conectar-sequencia' || this.modo === 'conectar-mensagem') {
      ev.stopPropagation();
      if (!el) return;
      if (!this.conexao) {
        this.conexao = { origem: id };
        this.selecionar([id]);
        this.app.mostrarDica('Selecione o elemento de destino.');
      } else {
        var tipo = this.modo === 'conectar-mensagem' ? 'messageFlow' : 'sequenceFlow';
        this.criarFluxo(this.conexao.origem, id, tipo);
        this.conexao = null;
      }
      return;
    }

    if (this.modo.indexOf('criar') === 0) return;

    ev.stopPropagation();
    var jaSelecionado = this.selecao.indexOf(id) !== -1;
    if (ev.shiftKey || ev.ctrlKey) {
      if (jaSelecionado) this.selecao.splice(this.selecao.indexOf(id), 1);
      else this.selecao.push(id);
      this.selecionar(this.selecao.slice());
    } else if (!jaSelecionado) {
      this.selecionar([id]);
    }

    if (el && el.bounds && this.habilitado) {
      var p = this.r.paraDiagrama(ev.clientX, ev.clientY);
      var self = this;
      this.arrasto = {
        tipo: 'mover',
        p0: p,
        itens: this.selecao.filter(function (sid) { return m.elementos[sid] && m.elementos[sid].bounds; })
          .map(function (sid) {
            return { id: sid, b0: Object.assign({}, m.elementos[sid].bounds), filhos: self._filhosDe(sid) };
          }),
        moveu: false
      };
    }
  };

  /** Elementos que devem se mover junto (conteudo de piscina/raia/grupo). */
  Editor.prototype._filhosDe = function (id) {
    var m = this.modelo();
    var e = m.elementos[id];
    if (!e) return [];
    var lista = [];
    if (e.tipo === 'participant') {
      m.ordem.forEach(function (cid) {
        var c = m.elementos[cid];
        if (cid !== id && c.bounds && (c.participantId === id || c.laneId && m.elementos[c.laneId] && m.elementos[c.laneId].participantId === id)) {
          lista.push({ id: cid, b0: Object.assign({}, c.bounds) });
        }
      });
    } else if (e.tipo === 'lane') {
      m.ordem.forEach(function (cid) {
        var c = m.elementos[cid];
        if (cid !== id && c.bounds && c.laneId === id) lista.push({ id: cid, b0: Object.assign({}, c.bounds) });
      });
    } else if (e.tipo === 'group') {
      var b = e.bounds;
      m.ordem.forEach(function (cid) {
        var c = m.elementos[cid];
        if (cid === id || !c.bounds || c.tipo === 'participant' || c.tipo === 'lane') return;
        var ce = u.centro(c.bounds);
        if (ce.x >= b.x && ce.x <= b.x + b.width && ce.y >= b.y && ce.y <= b.y + b.height) {
          lista.push({ id: cid, b0: Object.assign({}, c.bounds) });
        }
      });
    }
    // eventos de borda acompanham a atividade
    if (spec.ehAtividade(e.tipo)) {
      (e.bordas || []).forEach(function (bid) {
        var b2 = m.elementos[bid];
        if (b2 && b2.bounds) lista.push({ id: bid, b0: Object.assign({}, b2.bounds) });
      });
    }
    return lista;
  };

  Editor.prototype._mousemove = function (ev) {
    var a = this.arrasto;
    if (!a) {
      if (this.conexao) this.desenharAuxiliares(this.r.paraDiagrama(ev.clientX, ev.clientY));
      return;
    }
    if (a.tipo === 'pan') {
      this.r.tx = a.tx + (ev.clientX - a.x0);
      this.r.ty = a.ty + (ev.clientY - a.y0);
      this.r.aplicarTransform();
      return;
    }
    var m = this.modelo();
    var p = this.r.paraDiagrama(ev.clientX, ev.clientY);

    if (a.tipo === 'mover') {
      var dx = arredonda(p.x - a.p0.x);
      var dy = arredonda(p.y - a.p0.y);
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) a.moveu = true;
      a.itens.forEach(function (it) {
        var el = m.elementos[it.id];
        el.bounds.x = it.b0.x + dx;
        el.bounds.y = it.b0.y + dy;
        it.filhos.forEach(function (f) {
          var c = m.elementos[f.id];
          if (!c) return;
          c.bounds.x = f.b0.x + dx;
          c.bounds.y = f.b0.y + dy;
        });
      });
      this._limparWaypointsAfetados(a.itens.map(function (i) { return i.id; }));
      this.app.redesenhar({ leve: true });
      return;
    }

    if (a.tipo === 'redimensionar') {
      var el = m.elementos[a.id];
      var b = Object.assign({}, a.b0);
      var dx2 = p.x - a.p0.x;
      var dy2 = p.y - a.p0.y;
      if (a.canto.indexOf('l') !== -1) { b.x = arredonda(a.b0.x + dx2); b.width = arredonda(a.b0.width - dx2); }
      if (a.canto.indexOf('r') !== -1) { b.width = arredonda(a.b0.width + dx2); }
      if (a.canto.indexOf('t') !== -1) { b.y = arredonda(a.b0.y + dy2); b.height = arredonda(a.b0.height - dy2); }
      if (a.canto.indexOf('b') !== -1) { b.height = arredonda(a.b0.height + dy2); }
      b.width = Math.max(30, b.width);
      b.height = Math.max(24, b.height);
      el.bounds = b;
      this._limparWaypointsAfetados([a.id]);
      this.app.redesenhar({ leve: true });
      return;
    }
  };

  Editor.prototype._mouseup = function () {
    var a = this.arrasto;
    this.arrasto = null;
    if (!a) return;
    if (a.tipo === 'mover' && a.moveu) {
      this.reatribuirContainers(a.itens.map(function (i) { return i.id; }));
      this.snapshot();
      this.app.marcarAlterado();
      this.app.redesenhar();
    } else if (a.tipo === 'redimensionar') {
      this.snapshot();
      this.app.marcarAlterado();
      this.app.redesenhar();
    }
  };

  Editor.prototype._limparWaypointsAfetados = function (ids) {
    var m = this.modelo();
    var conjunto = {};
    ids.forEach(function (i) { conjunto[i] = true; });
    m.ordemFluxos.forEach(function (fid) {
      var f = m.fluxos[fid];
      if (conjunto[f.origem] || conjunto[f.alvo]) f.waypoints = [];
    });
  };

  function arredonda(v) { return Math.round(v / GRADE) * GRADE; }

  /* ----------------------------------------------------- selecao */

  Editor.prototype.selecionar = function (ids) {
    this.selecao = ids || [];
    this.r.selecionar(this.selecao);
    this.desenharAuxiliares();
    this.app.mostrarPropriedades(this.selecao);
  };

  Editor.prototype.desenharAuxiliares = function (pontoMouse) {
    var camada = this.r.camadas.overlay;
    u.$$('.aux-edicao', camada).forEach(function (n) { n.remove(); });
    var m = this.modelo();
    if (!m) return;
    var g = u.el('g', { class: 'aux-edicao' }, camada);
    var self = this;

    if (this.habilitado) {
      this.selecao.forEach(function (id) {
        var el = m.elementos[id];
        if (!el || !el.bounds) return;
        var b = el.bounds;
        u.el('rect', { x: b.x - 4, y: b.y - 4, width: b.width + 8, height: b.height + 8, class: 'contorno-selecao' }, g);
        var cantos = [['tl', b.x, b.y], ['tr', b.x + b.width, b.y], ['bl', b.x, b.y + b.height], ['br', b.x + b.width, b.y + b.height]];
        var redimensionavel = ['atividade', 'container', 'artefato'].indexOf(spec.categoria(el.tipo)) !== -1;
        if (redimensionavel && self.selecao.length === 1) {
          cantos.forEach(function (c) {
            var alca = u.el('rect', { x: c[1] - 4, y: c[2] - 4, width: 8, height: 8, class: 'alca', 'data-canto': c[0] }, g);
            alca.addEventListener('mousedown', function (ev) {
              ev.stopPropagation();
              self.arrasto = {
                tipo: 'redimensionar', id: id, canto: c[0],
                b0: Object.assign({}, b), p0: self.r.paraDiagrama(ev.clientX, ev.clientY)
              };
            });
          });
        }
      });
    }

    if (this.conexao && pontoMouse) {
      var o = m.elementos[this.conexao.origem];
      if (o && o.bounds) {
        var c0 = u.centro(o.bounds);
        u.el('line', {
          x1: c0.x, y1: c0.y, x2: pontoMouse.x, y2: pontoMouse.y,
          class: 'linha-conexao-previa' + (this.modo === 'conectar-mensagem' ? ' mensagem' : '')
        }, g);
      }
    }
  };

  /* --------------------------------------------------- criacao */

  Editor.prototype.contextoDoPonto = function (p) {
    var m = this.modelo();
    var raia = null, piscina = null;
    m.ordem.forEach(function (id) {
      var e = m.elementos[id];
      if (!e.bounds) return;
      var dentro = p.x >= e.bounds.x && p.x <= e.bounds.x + e.bounds.width &&
        p.y >= e.bounds.y && p.y <= e.bounds.y + e.bounds.height;
      if (!dentro) return;
      if (e.tipo === 'lane' && (!raia || e.bounds.height < raia.bounds.height)) raia = e;
      if (e.tipo === 'participant' && (!piscina || e.bounds.height < piscina.bounds.height)) piscina = e;
    });
    var processoId = null;
    if (raia) processoId = raia.pai;
    else if (piscina) processoId = piscina.processRef;
    if (!processoId) processoId = m.ordemProcessos[0];
    if (!processoId) processoId = this.garantirProcesso();
    return {
      pai: processoId,
      participantId: piscina ? piscina.id : (raia ? raia.participantId : null),
      laneId: raia ? raia.id : null
    };
  };

  Editor.prototype.garantirProcesso = function () {
    var m = this.modelo();
    if (m.ordemProcessos.length) return m.ordemProcessos[0];
    var pid = u.uid('Process');
    m.processos[pid] = { id: pid, nome: 'Processo', isExecutable: false, participantId: null };
    m.ordemProcessos.push(pid);
    if (!m.planoElemento) m.planoElemento = pid;
    return pid;
  };

  Editor.prototype.criarNoPonto = function (p) {
    var tipo = this.tipoNovo;
    if (!tipo) return;
    var m = this.modelo();
    this.snapshot();
    var t = SB.layout.tamanhoPadrao(tipo);
    var ctx = this.contextoDoPonto(p);

    var novo = {
      id: u.uid(prefixoDe(tipo)),
      tipo: tipo,
      nome: '',
      pai: ctx.pai,
      participantId: ctx.participantId,
      laneId: ctx.laneId,
      definicoes: spec.ehEvento(tipo) ? [this.defNovo || 'none'] : [],
      bounds: { x: arredonda(p.x - t.width / 2), y: arredonda(p.y - t.height / 2), width: t.width, height: t.height },
      entradas: [], saidas: [], bordas: [],
      sim: {}
    };

    if (tipo === 'participant') {
      var pid = u.uid('Process');
      m.processos[pid] = { id: pid, nome: '', isExecutable: false, participantId: novo.id };
      m.ordemProcessos.push(pid);
      novo.processRef = pid;
      novo.nome = 'Novo participante';
      novo.pai = null;
      novo.isHorizontal = true;
      if (!m.colaboracao) m.colaboracao = { id: u.uid('Collaboration'), nome: '' };
      m.planoElemento = m.colaboracao.id;
    }
    if (tipo === 'lane') {
      novo.nome = 'Nova raia';
      novo.pai = ctx.pai;
      novo.participantId = ctx.participantId;
      novo.laneId = null;
      novo.refs = [];
    }
    if (tipo === 'textAnnotation') novo.texto = 'Anotacao';
    if (tipo === 'subProcess' || tipo === 'transaction') novo.expandido = true;
    if (spec.ehAtividade(tipo)) novo.nome = 'Nova tarefa';
    if (spec.ehGateway(tipo)) novo.nome = '';

    SB.parser.addElemento(m, novo);
    SB.parser.indexar(m);
    this.app.marcarAlterado();
    this.app.redesenhar();
    this.selecionar([novo.id]);
    if (!this.app.fixarPaleta) this.definirModo('selecionar');
    this.app.focarNomeNasPropriedades(novo.id);
  };

  function prefixoDe(tipo) {
    if (tipo === 'startEvent') return 'Inicio';
    if (tipo === 'endEvent') return 'Fim';
    if (spec.ehGateway(tipo)) return 'GW';
    if (spec.ehAtividade(tipo)) return 'Atividade';
    if (spec.ehEvento(tipo)) return 'Evento';
    if (tipo === 'participant') return 'Participante';
    if (tipo === 'lane') return 'Raia';
    return tipo.charAt(0).toUpperCase() + tipo.slice(1);
  }

  /** Anexa um evento de borda a uma atividade. */
  Editor.prototype.adicionarBorda = function (atividadeId, def) {
    var m = this.modelo();
    var host = m.elementos[atividadeId];
    if (!host || !spec.ehAtividade(host.tipo)) {
      this.app.mostrarDica('Selecione uma atividade para anexar o evento de borda.', 'erro');
      return;
    }
    this.snapshot();
    var t = SB.layout.tamanhoPadrao('boundaryEvent');
    var n = (host.bordas || []).length;
    var novo = {
      id: u.uid('Borda'),
      tipo: 'boundaryEvent',
      nome: '',
      pai: host.pai,
      participantId: host.participantId,
      laneId: host.laneId,
      definicoes: [def || 'timer'],
      attachedToRef: atividadeId,
      cancelActivity: true,
      bounds: {
        x: host.bounds.x + 20 + n * 44 - t.width / 2,
        y: host.bounds.y + host.bounds.height - t.height / 2,
        width: t.width, height: t.height
      },
      entradas: [], saidas: [], bordas: [], sim: {}
    };
    SB.parser.addElemento(m, novo);
    SB.parser.indexar(m);
    this.app.marcarAlterado();
    this.app.redesenhar();
    this.selecionar([novo.id]);
  };

  /* ----------------------------------------------------- conexao */

  Editor.prototype.podeConectar = function (origemId, alvoId, tipo) {
    var m = this.modelo();
    var o = m.elementos[origemId];
    var a = m.elementos[alvoId];
    if (!o || !a) return 'Elemento inexistente.';
    if (origemId === alvoId) return 'Um elemento nao pode se conectar a si mesmo.';

    var pOrigem = o.tipo === 'participant' ? o.id : o.participantId;
    var pAlvo = a.tipo === 'participant' ? a.id : a.participantId;

    if (tipo === 'sequenceFlow') {
      if (!spec.podeSerOrigemSequencia(o.tipo)) {
        return spec.rotulo(o.tipo) + ' nao pode ser origem de fluxo de sequencia (Tabela 7.3 do BPMN 2.0.2).';
      }
      if (!spec.podeSerAlvoSequencia(a.tipo)) {
        return spec.rotulo(a.tipo) + ' nao pode ser alvo de fluxo de sequencia (Tabela 7.3 do BPMN 2.0.2).';
      }
      if (pOrigem && pAlvo && pOrigem !== pAlvo) {
        return 'Fluxo de sequencia nao pode cruzar a fronteira de uma piscina (clausula 7.6.1). Use um fluxo de mensagem.';
      }
      var duplicado = m.ordemFluxos.some(function (fid) {
        var f = m.fluxos[fid];
        return f.tipo === 'sequenceFlow' && f.origem === origemId && f.alvo === alvoId;
      });
      if (duplicado) return 'Ja existe um fluxo de sequencia entre esses dois elementos.';
      return null;
    }

    if (tipo === 'messageFlow') {
      if (!spec.podeSerOrigemMensagem(o.tipo, o.definicoes)) {
        return spec.rotulo(o.tipo) + ' nao pode ser origem de fluxo de mensagem (Tabela 7.4 do BPMN 2.0.2).';
      }
      if (!spec.podeSerAlvoMensagem(a.tipo, a.definicoes)) {
        return spec.rotulo(a.tipo) + ' nao pode ser alvo de fluxo de mensagem (Tabela 7.4 do BPMN 2.0.2).';
      }
      if (pOrigem && pAlvo && pOrigem === pAlvo) {
        return 'Fluxo de mensagem so pode ligar participantes diferentes (clausula 7.6.2).';
      }
      return null;
    }
    return null;
  };

  Editor.prototype.criarFluxo = function (origemId, alvoId, tipo) {
    var m = this.modelo();
    var erro = this.podeConectar(origemId, alvoId, tipo);
    if (erro) {
      this.app.mostrarDica(erro, 'erro');
      this.selecionar([]);
      return null;
    }
    this.snapshot();
    var f = {
      id: u.uid(tipo === 'messageFlow' ? 'Msg' : 'Flow'),
      tipo: tipo,
      nome: '',
      origem: origemId,
      alvo: alvoId,
      waypoints: [],
      condicao: '',
      pai: tipo === 'messageFlow'
        ? ((m.colaboracao && m.colaboracao.id) || this.garantirColaboracao())
        : m.elementos[origemId].pai,
      sim: {}
    };
    SB.parser.addFluxo(m, f);
    SB.parser.indexar(m);
    this.app.marcarAlterado();
    this.app.redesenhar();
    this.selecionar([f.id]);
    this.app.mostrarDica('Fluxo criado.');
    return f;
  };

  Editor.prototype.garantirColaboracao = function () {
    var m = this.modelo();
    if (!m.colaboracao) m.colaboracao = { id: u.uid('Collaboration'), nome: '' };
    return m.colaboracao.id;
  };

  /* --------------------------------------------------- exclusao */

  Editor.prototype.excluirSelecao = function () {
    var m = this.modelo();
    if (!this.selecao.length) return;
    this.snapshot();
    var self = this;
    this.selecao.slice().forEach(function (id) { self._excluir(id); });
    SB.parser.indexar(m);
    this.selecionar([]);
    this.app.marcarAlterado();
    this.app.redesenhar();
  };

  Editor.prototype._excluir = function (id) {
    var m = this.modelo();
    if (m.fluxos[id]) {
      delete m.fluxos[id];
      var i = m.ordemFluxos.indexOf(id);
      if (i !== -1) m.ordemFluxos.splice(i, 1);
      return;
    }
    var e = m.elementos[id];
    if (!e) return;
    var self = this;

    // remove fluxos ligados
    m.ordemFluxos.slice().forEach(function (fid) {
      var f = m.fluxos[fid];
      if (f.origem === id || f.alvo === id) self._excluir(fid);
    });
    // remove eventos de borda
    (e.bordas || []).slice().forEach(function (bid) { self._excluir(bid); });
    // remove filhos de piscina/raia/subprocesso
    if (e.tipo === 'participant') {
      m.ordem.slice().forEach(function (cid) {
        var c = m.elementos[cid];
        if (c && cid !== id && c.participantId === id) self._excluir(cid);
      });
      if (e.processRef) {
        delete m.processos[e.processRef];
        var ip = m.ordemProcessos.indexOf(e.processRef);
        if (ip !== -1) m.ordemProcessos.splice(ip, 1);
      }
    } else if (e.tipo === 'subProcess' || e.tipo === 'transaction') {
      m.ordem.slice().forEach(function (cid) {
        var c = m.elementos[cid];
        if (c && c.pai === id) self._excluir(cid);
      });
    }

    delete m.elementos[id];
    var k = m.ordem.indexOf(id);
    if (k !== -1) m.ordem.splice(k, 1);
  };

  /* --------------------------------------- reatribuicao por geometria */

  Editor.prototype.reatribuirContainers = function (ids) {
    var m = this.modelo();
    var self = this;
    (ids || []).forEach(function (id) {
      var e = m.elementos[id];
      if (!e || !e.bounds) return;
      if (e.tipo === 'participant' || e.tipo === 'lane') return;
      if (['evento', 'atividade', 'gateway'].indexOf(spec.categoria(e.tipo)) === -1) return;
      var ctx = self.contextoDoPonto(u.centro(e.bounds));
      e.pai = ctx.pai;
      e.participantId = ctx.participantId;
      e.laneId = ctx.laneId;
    });
  };

  /* ------------------------------------------------- modelo vazio */

  function modeloVazio(comPiscinas) {
    var m = SB.parser.novoModelo();
    var pid = 'Process_1';
    m.processos[pid] = { id: pid, nome: 'Novo processo', isExecutable: false, participantId: null };
    m.ordemProcessos.push(pid);
    m.nome = 'Novo processo';
    m.definitionsId = 'Definitions_' + Date.now().toString(36);

    if (comPiscinas) {
      var part = {
        id: 'Participant_1', tipo: 'participant', nome: 'Minha organizacao',
        processRef: pid, definicoes: [], isHorizontal: true,
        bounds: { x: 160, y: 80, width: 900, height: 320 }
      };
      SB.parser.addElemento(m, part);
      m.processos[pid].participantId = part.id;
      m.colaboracao = { id: 'Collaboration_1', nome: '' };
      m.planoElemento = m.colaboracao.id;
      ['Area 1', 'Area 2'].forEach(function (nome, i) {
        SB.parser.addElemento(m, {
          id: 'Lane_' + (i + 1), tipo: 'lane', nome: nome, pai: pid,
          participantId: part.id, definicoes: [], refs: [],
          bounds: { x: 190, y: 80 + i * 160, width: 870, height: 160 }
        });
      });
      SB.parser.addElemento(m, {
        id: 'Inicio_1', tipo: 'startEvent', nome: 'Processo iniciado', pai: pid,
        participantId: part.id, laneId: 'Lane_1', definicoes: ['none'],
        bounds: { x: 240, y: 142, width: 36, height: 36 }, sim: {}
      });
    } else {
      m.planoElemento = pid;
      SB.parser.addElemento(m, {
        id: 'Inicio_1', tipo: 'startEvent', nome: 'Processo iniciado', pai: pid,
        definicoes: ['none'], bounds: { x: 180, y: 180, width: 36, height: 36 }, sim: {}
      });
    }
    return SB.parser.indexar(m);
  }

  Editor.modeloVazio = modeloVazio;
  SB.Editor = Editor;
})(window);
