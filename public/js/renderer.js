/*
 * Renderizador SVG do diagrama BPMN.
 * Segue a notacao grafica normativa do BPMN 2.0.2:
 *  - Evento: circulo (inicio linha fina, intermediario linha dupla, fim linha grossa)
 *  - Atividade: retangulo de cantos arredondados, com marcador de tipo no canto
 *  - Gateway: losango com marcador interno (X, +, O, *, evento multiplo)
 *  - Piscina/Raia: retangulo com faixa de titulo
 *  - Fluxo de sequencia: linha solida com ponta cheia
 *  - Fluxo de mensagem: linha tracejada, circulo na origem e ponta vazada
 *  - Associacao: linha pontilhada
 */
(function (global) {
  'use strict';
  var SB = global.SB || (global.SB = {});
  var u = SB.util;
  var spec = SB.spec;

  var EV_R = 18;

  function Renderer(svg) {
    this.svg = svg;
    this.modelo = null;
    this.viewport = null;
    this.mapaNos = {};
    this.mapaFluxos = {};
    this.escala = 1;
    this.tx = 0;
    this.ty = 0;
    this.aoSelecionar = null;
    this.aoClicarFundo = null;
    this._montarBase();
  }

  Renderer.prototype._montarBase = function () {
    var svg = this.svg;
    svg.innerHTML = '';
    var defs = u.el('defs', {}, svg);

    // ponta de seta cheia (fluxo de sequencia)
    var m1 = u.el('marker', { id: 'seta-sequencia', viewBox: '0 0 12 12', refX: '11', refY: '6', markerWidth: '9', markerHeight: '9', orient: 'auto-start-reverse' }, defs);
    u.el('path', { d: 'M 1 1 L 11 6 L 1 11 z', class: 'marcador-cheio' }, m1);

    // ponta vazada (fluxo de mensagem)
    var m2 = u.el('marker', { id: 'seta-mensagem', viewBox: '0 0 12 12', refX: '11', refY: '6', markerWidth: '10', markerHeight: '10', orient: 'auto-start-reverse' }, defs);
    u.el('path', { d: 'M 1 1 L 11 6 L 1 11 z', class: 'marcador-vazado' }, m2);

    // circulo de origem do fluxo de mensagem
    var m3 = u.el('marker', { id: 'inicio-mensagem', viewBox: '0 0 10 10', refX: '5', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto' }, defs);
    u.el('circle', { cx: 5, cy: 5, r: 3.4, class: 'marcador-vazado' }, m3);

    // ponta fina (associacao direcionada)
    var m4 = u.el('marker', { id: 'seta-associacao', viewBox: '0 0 12 12', refX: '11', refY: '6', markerWidth: '9', markerHeight: '9', orient: 'auto-start-reverse' }, defs);
    u.el('path', { d: 'M 2 2 L 11 6 L 2 10', class: 'marcador-linha' }, m4);

    this.viewport = u.el('g', { class: 'viewport' }, svg);
    this.camadas = {
      piscinas: u.el('g', { class: 'camada-piscinas' }, this.viewport),
      grupos: u.el('g', { class: 'camada-grupos' }, this.viewport),
      arestas: u.el('g', { class: 'camada-arestas' }, this.viewport),
      nos: u.el('g', { class: 'camada-nos' }, this.viewport),
      rotulos: u.el('g', { class: 'camada-rotulos' }, this.viewport),
      overlay: u.el('g', { class: 'camada-overlay' }, this.viewport)
    };
  };

  Renderer.prototype.aplicarTransform = function () {
    this.viewport.setAttribute('transform', 'translate(' + this.tx + ',' + this.ty + ') scale(' + this.escala + ')');
  };

  Renderer.prototype.ajustarNaTela = function (margem) {
    var m = this.modelo;
    if (!m) return;
    var lim = SB.layout.limites(m);
    var r = this.svg.getBoundingClientRect();
    var mg = margem === undefined ? 40 : margem;
    var sx = (r.width - mg * 2) / Math.max(1, lim.width);
    var sy = (r.height - mg * 2) / Math.max(1, lim.height);
    this.escala = Math.max(0.08, Math.min(2.2, Math.min(sx, sy)));
    this.tx = mg - lim.x * this.escala + (r.width - mg * 2 - lim.width * this.escala) / 2;
    this.ty = mg - lim.y * this.escala + (r.height - mg * 2 - lim.height * this.escala) / 2;
    this.aplicarTransform();
  };

  Renderer.prototype.zoom = function (fator, cx, cy) {
    var r = this.svg.getBoundingClientRect();
    var px = cx === undefined ? r.width / 2 : cx;
    var py = cy === undefined ? r.height / 2 : cy;
    var nova = Math.max(0.08, Math.min(4, this.escala * fator));
    var k = nova / this.escala;
    this.tx = px - (px - this.tx) * k;
    this.ty = py - (py - this.ty) * k;
    this.escala = nova;
    this.aplicarTransform();
  };

  /** Converte coordenada de tela para coordenada do diagrama. */
  Renderer.prototype.paraDiagrama = function (clientX, clientY) {
    var r = this.svg.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.tx) / this.escala,
      y: (clientY - r.top - this.ty) / this.escala
    };
  };

  /* ================================================================
   * Desenho
   * ================================================================ */

  Renderer.prototype.render = function (modelo) {
    this.modelo = modelo;
    var self = this;
    ['piscinas', 'grupos', 'arestas', 'nos', 'rotulos', 'overlay'].forEach(function (k) {
      self.camadas[k].innerHTML = '';
    });
    this.mapaNos = {};
    this.mapaFluxos = {};
    if (!modelo) return;

    var elementos = modelo.ordem.map(function (id) { return modelo.elementos[id]; });

    elementos.filter(function (e) { return e.tipo === 'participant'; }).forEach(function (e) { self._piscina(e); });
    elementos.filter(function (e) { return e.tipo === 'lane'; }).forEach(function (e) { self._raia(e); });
    elementos.filter(function (e) { return e.tipo === 'group'; }).forEach(function (e) { self._grupo(e); });

    modelo.ordemFluxos.forEach(function (fid) { self._fluxo(modelo.fluxos[fid]); });

    elementos.filter(function (e) {
      return ['evento', 'atividade', 'gateway', 'dado', 'artefato'].indexOf(spec.categoria(e.tipo)) !== -1 && e.tipo !== 'group';
    }).forEach(function (e) { self._no(e); });
  };

  Renderer.prototype._registrar = function (g, e) {
    var self = this;
    this.mapaNos[e.id] = g;
    g.setAttribute('data-id', e.id);
    g.addEventListener('mousedown', function (ev) {
      if (self.aoSelecionar) self.aoSelecionar(e.id, ev);
    });
  };

  /* ------------------------------------------------------ piscina/raia */

  Renderer.prototype._piscina = function (e) {
    if (!e.bounds) return;
    var b = e.bounds;
    var g = u.el('g', { class: 'bpmn-piscina' }, this.camadas.piscinas);
    u.el('rect', { x: b.x, y: b.y, width: b.width, height: b.height, class: 'forma-piscina' }, g);
    u.el('line', { x1: b.x + 30, y1: b.y, x2: b.x + 30, y2: b.y + b.height, class: 'linha-piscina' }, g);
    var t = u.el('text', {
      x: b.x + 15, y: b.y + b.height / 2, class: 'rotulo-piscina',
      transform: 'rotate(-90 ' + (b.x + 15) + ' ' + (b.y + b.height / 2) + ')'
    }, g);
    t.textContent = e.nome || '(participante)';
    if (!e.processRef) g.classList.add('caixa-preta');
    this._registrar(g, e);
  };

  Renderer.prototype._raia = function (e) {
    if (!e.bounds) return;
    var b = e.bounds;
    var g = u.el('g', { class: 'bpmn-raia' }, this.camadas.piscinas);
    u.el('rect', { x: b.x, y: b.y, width: b.width, height: b.height, class: 'forma-raia' }, g);
    u.el('line', { x1: b.x + 26, y1: b.y, x2: b.x + 26, y2: b.y + b.height, class: 'linha-piscina' }, g);
    var t = u.el('text', {
      x: b.x + 13, y: b.y + b.height / 2, class: 'rotulo-raia',
      transform: 'rotate(-90 ' + (b.x + 13) + ' ' + (b.y + b.height / 2) + ')'
    }, g);
    t.textContent = e.nome || '';
    this._registrar(g, e);
  };

  Renderer.prototype._grupo = function (e) {
    if (!e.bounds) return;
    var b = e.bounds;
    var g = u.el('g', { class: 'bpmn-grupo' }, this.camadas.grupos);
    u.el('rect', { x: b.x, y: b.y, width: b.width, height: b.height, rx: 10, ry: 10, class: 'forma-grupo' }, g);
    if (e.nome) {
      var t = u.el('text', { x: b.x + 10, y: b.y + 18, class: 'rotulo-grupo' }, g);
      t.textContent = e.nome;
    }
    this._registrar(g, e);
  };

  /* ------------------------------------------------------------- nos */

  Renderer.prototype._no = function (e) {
    if (!e.bounds) return;
    var cat = spec.categoria(e.tipo);
    var g = u.el('g', { class: 'bpmn-no cat-' + cat + ' tipo-' + e.tipo }, this.camadas.nos);
    if (cat === 'evento') this._evento(g, e);
    else if (cat === 'atividade') this._atividade(g, e);
    else if (cat === 'gateway') this._gateway(g, e);
    else if (cat === 'dado') this._dado(g, e);
    else if (e.tipo === 'textAnnotation') this._anotacao(g, e);
    this._registrar(g, e);
  };

  Renderer.prototype._evento = function (g, e) {
    var b = e.bounds;
    var c = u.centro(b);
    var r = Math.min(b.width, b.height) / 2;
    var classe = 'forma-evento';
    if (e.tipo === 'endEvent') classe += ' evento-fim';
    else if (e.tipo === 'startEvent') classe += ' evento-inicio';
    else classe += ' evento-intermediario';

    if (e.tipo === 'intermediateCatchEvent' || e.tipo === 'intermediateThrowEvent' || e.tipo === 'boundaryEvent') {
      u.el('circle', { cx: c.x, cy: c.y, r: r, class: classe + (e.cancelActivity === false ? ' nao-interrompe' : '') }, g);
      u.el('circle', { cx: c.x, cy: c.y, r: r - 3.5, class: 'forma-evento anel-interno' + (e.cancelActivity === false ? ' nao-interrompe' : '') }, g);
    } else {
      u.el('circle', { cx: c.x, cy: c.y, r: r, class: classe }, g);
    }

    var disparo = e.tipo === 'intermediateThrowEvent' || e.tipo === 'endEvent';
    var def = (e.definicoes && e.definicoes.length) ? e.definicoes[0] : 'none';
    if (e.definicoes && e.definicoes.length > 1) def = 'multiple';
    this._simboloEvento(g, def, c, r * 0.62, disparo);
    this._rotuloExterno(e, c.x, b.y + b.height + 4);
  };

  Renderer.prototype._simboloEvento = function (g, def, c, s, preenchido) {
    var cls = 'simbolo-evento' + (preenchido ? ' preenchido' : '');
    switch (def) {
      case 'message':
        u.el('rect', { x: c.x - s, y: c.y - s * 0.68, width: s * 2, height: s * 1.36, class: cls }, g);
        u.el('path', { d: 'M ' + (c.x - s) + ' ' + (c.y - s * 0.68) + ' L ' + c.x + ' ' + (c.y + s * 0.12) + ' L ' + (c.x + s) + ' ' + (c.y - s * 0.68), class: cls + ' traco' }, g);
        break;
      case 'timer':
        u.el('circle', { cx: c.x, cy: c.y, r: s, class: 'simbolo-evento' }, g);
        u.el('path', { d: 'M ' + c.x + ' ' + (c.y - s * 0.62) + ' L ' + c.x + ' ' + c.y + ' L ' + (c.x + s * 0.5) + ' ' + (c.y + s * 0.32), class: 'simbolo-evento traco' }, g);
        for (var i = 0; i < 12; i++) {
          var a = i * Math.PI / 6;
          u.el('line', {
            x1: c.x + Math.cos(a) * s * 0.82, y1: c.y + Math.sin(a) * s * 0.82,
            x2: c.x + Math.cos(a) * s, y2: c.y + Math.sin(a) * s, class: 'simbolo-evento traco fino'
          }, g);
        }
        break;
      case 'error':
        u.el('path', {
          d: 'M ' + (c.x - s) + ' ' + (c.y + s * 0.8) + ' L ' + (c.x - s * 0.25) + ' ' + (c.y - s * 0.35) +
             ' L ' + (c.x + s * 0.25) + ' ' + (c.y + s * 0.25) + ' L ' + (c.x + s) + ' ' + (c.y - s * 0.85) +
             ' L ' + (c.x + s * 0.25) + ' ' + (c.y + s * 0.85) + ' L ' + (c.x - s * 0.3) + ' ' + (c.y + s * 0.05) + ' Z',
          class: cls
        }, g);
        break;
      case 'escalation':
        u.el('path', { d: 'M ' + c.x + ' ' + (c.y - s) + ' L ' + (c.x + s * 0.8) + ' ' + (c.y + s) + ' L ' + c.x + ' ' + (c.y + s * 0.1) + ' L ' + (c.x - s * 0.8) + ' ' + (c.y + s) + ' Z', class: cls }, g);
        break;
      case 'signal':
        u.el('path', { d: 'M ' + c.x + ' ' + (c.y - s) + ' L ' + (c.x + s * 0.92) + ' ' + (c.y + s * 0.7) + ' L ' + (c.x - s * 0.92) + ' ' + (c.y + s * 0.7) + ' Z', class: cls }, g);
        break;
      case 'terminate':
        u.el('circle', { cx: c.x, cy: c.y, r: s, class: 'simbolo-evento preenchido' }, g);
        break;
      case 'cancel':
        u.el('path', {
          d: 'M ' + (c.x - s * 0.75) + ' ' + (c.y - s * 0.75) + ' L ' + (c.x + s * 0.75) + ' ' + (c.y + s * 0.75) +
             ' M ' + (c.x + s * 0.75) + ' ' + (c.y - s * 0.75) + ' L ' + (c.x - s * 0.75) + ' ' + (c.y + s * 0.75),
          class: 'simbolo-evento traco grosso'
        }, g);
        break;
      case 'compensate':
        u.el('path', { d: 'M ' + c.x + ' ' + (c.y - s * 0.75) + ' L ' + c.x + ' ' + (c.y + s * 0.75) + ' L ' + (c.x - s) + ' ' + c.y + ' Z', class: cls }, g);
        u.el('path', { d: 'M ' + (c.x + s) + ' ' + (c.y - s * 0.75) + ' L ' + (c.x + s) + ' ' + (c.y + s * 0.75) + ' L ' + c.x + ' ' + c.y + ' Z', class: cls }, g);
        break;
      case 'conditional':
        u.el('rect', { x: c.x - s * 0.8, y: c.y - s * 0.9, width: s * 1.6, height: s * 1.8, class: 'simbolo-evento' }, g);
        for (var j = 0; j < 3; j++) {
          u.el('line', { x1: c.x - s * 0.55, y1: c.y - s * 0.45 + j * s * 0.45, x2: c.x + s * 0.55, y2: c.y - s * 0.45 + j * s * 0.45, class: 'simbolo-evento traco fino' }, g);
        }
        break;
      case 'link':
        u.el('path', { d: 'M ' + (c.x - s) + ' ' + (c.y - s * 0.35) + ' L ' + (c.x + s * 0.1) + ' ' + (c.y - s * 0.35) + ' L ' + (c.x + s * 0.1) + ' ' + (c.y - s * 0.75) + ' L ' + (c.x + s) + ' ' + c.y + ' L ' + (c.x + s * 0.1) + ' ' + (c.y + s * 0.75) + ' L ' + (c.x + s * 0.1) + ' ' + (c.y + s * 0.35) + ' L ' + (c.x - s) + ' ' + (c.y + s * 0.35) + ' Z', class: cls }, g);
        break;
      case 'parallelMultiple':
        u.el('path', { d: 'M ' + (c.x - s * 0.28) + ' ' + (c.y - s) + ' h ' + (s * 0.56) + ' v ' + (s * 0.72) + ' h ' + (s * 0.72) + ' v ' + (s * 0.56) + ' h ' + (-s * 0.72) + ' v ' + (s * 0.72) + ' h ' + (-s * 0.56) + ' v ' + (-s * 0.72) + ' h ' + (-s * 0.72) + ' v ' + (-s * 0.56) + ' h ' + (s * 0.72) + ' Z', class: cls }, g);
        break;
      case 'multiple':
        var pts = [];
        for (var k = 0; k < 5; k++) {
          var ang = -Math.PI / 2 + k * 2 * Math.PI / 5;
          pts.push((c.x + Math.cos(ang) * s) + ',' + (c.y + Math.sin(ang) * s));
        }
        u.el('polygon', { points: pts.join(' '), class: cls }, g);
        break;
      default:
        break; // none: sem simbolo
    }
  };

  Renderer.prototype._atividade = function (g, e) {
    var b = e.bounds;
    var classe = 'forma-atividade';
    if (e.tipo === 'callActivity') classe += ' borda-grossa';
    u.el('rect', { x: b.x, y: b.y, width: b.width, height: b.height, rx: 10, ry: 10, class: classe }, g);
    if (e.tipo === 'transaction') {
      u.el('rect', { x: b.x + 4, y: b.y + 4, width: b.width - 8, height: b.height - 8, rx: 8, ry: 8, class: 'forma-atividade' }, g);
    }
    this._marcadorTarefa(g, e, b);

    var container = e.tipo === 'subProcess' || e.tipo === 'transaction' || e.tipo === 'adHocSubProcess';
    var lgm = 8;
    var linhas = u.quebrarTexto(e.nome, b.width - lgm * 2, 12);
    var maxL = Math.max(1, Math.floor((b.height - 20) / 14));
    if (linhas.length > maxL) linhas = linhas.slice(0, maxL - 1).concat([linhas[maxL - 1].slice(0, 12) + '...']);
    var yBase = container ? b.y + 16 : u.centro(b).y - (linhas.length - 1) * 7;
    var t = u.el('text', { x: u.centro(b).x, y: yBase, class: 'rotulo-atividade' }, g);
    linhas.forEach(function (l, i) {
      var ts = u.el('tspan', { x: u.centro(b).x, dy: i === 0 ? 0 : 14 }, t);
      ts.textContent = l;
    });

    // marcadores inferiores (loop / multi-instancia / subprocesso colapsado)
    var mk = [];
    if (e.loop === 'standard') mk.push('loop');
    if (e.loop === 'paralelo') mk.push('mi-par');
    if (e.loop === 'sequencial') mk.push('mi-seq');
    if (container && e.expandido === false) mk.push('mais');
    if (e.tipo === 'adHocSubProcess') mk.push('adhoc');
    if (e.forCompensation) mk.push('compensa');
    var cx = u.centro(b).x - (mk.length - 1) * 9;
    var cy = b.y + b.height - 12;
    var self = this;
    mk.forEach(function (nome, i) { self._marcadorInferior(g, nome, cx + i * 18, cy); });
  };

  Renderer.prototype._marcadorInferior = function (g, nome, x, y) {
    var s = 6;
    if (nome === 'mais') {
      u.el('rect', { x: x - s, y: y - s, width: s * 2, height: s * 2, class: 'marcador-tarefa' }, g);
      u.el('path', { d: 'M ' + (x - 3.5) + ' ' + y + ' h 7 M ' + x + ' ' + (y - 3.5) + ' v 7', class: 'marcador-tarefa traco' }, g);
    } else if (nome === 'mi-par') {
      u.el('path', { d: 'M ' + (x - 4) + ' ' + (y - 5) + ' v 10 M ' + x + ' ' + (y - 5) + ' v 10 M ' + (x + 4) + ' ' + (y - 5) + ' v 10', class: 'marcador-tarefa traco grosso' }, g);
    } else if (nome === 'mi-seq') {
      u.el('path', { d: 'M ' + (x - 5) + ' ' + (y - 4) + ' h 10 M ' + (x - 5) + ' ' + y + ' h 10 M ' + (x - 5) + ' ' + (y + 4) + ' h 10', class: 'marcador-tarefa traco grosso' }, g);
    } else if (nome === 'loop') {
      u.el('path', { d: 'M ' + (x + 4) + ' ' + (y - 2) + ' A 5 5 0 1 0 ' + (x + 2) + ' ' + (y + 4.6), class: 'marcador-tarefa traco' }, g);
      u.el('path', { d: 'M ' + (x + 1) + ' ' + (y + 2) + ' L ' + (x + 3) + ' ' + (y + 5.4) + ' L ' + (x + 6) + ' ' + (y + 3.6), class: 'marcador-tarefa traco' }, g);
    } else if (nome === 'adhoc') {
      u.el('path', { d: 'M ' + (x - 6) + ' ' + (y + 2) + ' q 3 -6 6 0 q 3 6 6 0', class: 'marcador-tarefa traco grosso' }, g);
    } else if (nome === 'compensa') {
      u.el('path', { d: 'M ' + x + ' ' + (y - 5) + ' L ' + x + ' ' + (y + 5) + ' L ' + (x - 6) + ' ' + y + ' Z M ' + (x + 6) + ' ' + (y - 5) + ' L ' + (x + 6) + ' ' + (y + 5) + ' L ' + x + ' ' + y + ' Z', class: 'marcador-tarefa' }, g);
    }
  };

  Renderer.prototype._marcadorTarefa = function (g, e, b) {
    var x = b.x + 6;
    var y = b.y + 6;
    var t = spec.TIPOS[e.tipo] || {};
    var m = t.marcador;
    if (!m) return;
    var cls = 'marcador-tarefa';
    if (m === 'user') {
      u.el('circle', { cx: x + 7, cy: y + 5, r: 3.2, class: cls }, g);
      u.el('path', { d: 'M ' + (x + 1) + ' ' + (y + 15) + ' q 6 -7 12 0', class: cls + ' traco' }, g);
      u.el('rect', { x: x, y: y, width: 15, height: 15, class: cls + ' contorno' }, g);
    } else if (m === 'manual') {
      u.el('path', { d: 'M ' + x + ' ' + (y + 9) + ' q 2 -6 6 -4 l 5 1 q 3 1 2 4 l -1 4 q -1 2 -4 2 h -5 q -3 0 -3 -3 z', class: cls }, g);
    } else if (m === 'service') {
      u.el('circle', { cx: x + 7, cy: y + 7, r: 6, class: cls + ' contorno' }, g);
      u.el('circle', { cx: x + 7, cy: y + 7, r: 2.4, class: cls + ' contorno' }, g);
      for (var i = 0; i < 8; i++) {
        var a = i * Math.PI / 4;
        u.el('line', { x1: x + 7 + Math.cos(a) * 5.4, y1: y + 7 + Math.sin(a) * 5.4, x2: x + 7 + Math.cos(a) * 8, y2: y + 7 + Math.sin(a) * 8, class: cls + ' traco grosso' }, g);
      }
    } else if (m === 'script') {
      u.el('path', { d: 'M ' + (x + 3) + ' ' + y + ' q -3 4 0 8 q 3 4 0 8 h 9 q 3 -4 0 -8 q -3 -4 0 -8 z', class: cls + ' contorno' }, g);
      u.el('path', { d: 'M ' + (x + 4) + ' ' + (y + 5) + ' h 6 M ' + (x + 4) + ' ' + (y + 9) + ' h 6 M ' + (x + 4) + ' ' + (y + 13) + ' h 4', class: cls + ' traco fino' }, g);
    } else if (m === 'send') {
      u.el('rect', { x: x, y: y + 2, width: 16, height: 11, class: cls }, g);
      u.el('path', { d: 'M ' + x + ' ' + (y + 2) + ' L ' + (x + 8) + ' ' + (y + 9) + ' L ' + (x + 16) + ' ' + (y + 2), class: cls + ' traco claro' }, g);
    } else if (m === 'receive') {
      u.el('rect', { x: x, y: y + 2, width: 16, height: 11, class: cls + ' contorno' }, g);
      u.el('path', { d: 'M ' + x + ' ' + (y + 2) + ' L ' + (x + 8) + ' ' + (y + 9) + ' L ' + (x + 16) + ' ' + (y + 2), class: cls + ' traco' }, g);
    } else if (m === 'rule') {
      u.el('rect', { x: x, y: y + 1, width: 16, height: 13, class: cls + ' contorno' }, g);
      u.el('line', { x1: x, y1: y + 5, x2: x + 16, y2: y + 5, class: cls + ' traco' }, g);
      u.el('line', { x1: x + 5, y1: y + 5, x2: x + 5, y2: y + 14, class: cls + ' traco fino' }, g);
    }
  };

  Renderer.prototype._gateway = function (g, e) {
    var b = e.bounds;
    var c = u.centro(b);
    var hw = b.width / 2, hh = b.height / 2;
    var pts = [c.x + ',' + b.y, (b.x + b.width) + ',' + c.y, c.x + ',' + (b.y + b.height), b.x + ',' + c.y].join(' ');
    u.el('polygon', { points: pts, class: 'forma-gateway' }, g);
    var s = Math.min(hw, hh) * 0.52;

    switch (e.tipo) {
      case 'exclusiveGateway':
        u.el('path', {
          d: 'M ' + (c.x - s * 0.7) + ' ' + (c.y - s * 0.7) + ' L ' + (c.x + s * 0.7) + ' ' + (c.y + s * 0.7) +
             ' M ' + (c.x + s * 0.7) + ' ' + (c.y - s * 0.7) + ' L ' + (c.x - s * 0.7) + ' ' + (c.y + s * 0.7),
          class: 'marcador-gateway grosso'
        }, g);
        break;
      case 'parallelGateway':
        u.el('path', { d: 'M ' + (c.x - s) + ' ' + c.y + ' h ' + (s * 2) + ' M ' + c.x + ' ' + (c.y - s) + ' v ' + (s * 2), class: 'marcador-gateway grosso' }, g);
        break;
      case 'inclusiveGateway':
        u.el('circle', { cx: c.x, cy: c.y, r: s * 0.85, class: 'marcador-gateway grosso sem-preenchimento' }, g);
        break;
      case 'complexGateway':
        u.el('path', {
          d: 'M ' + (c.x - s) + ' ' + c.y + ' h ' + (s * 2) +
             ' M ' + c.x + ' ' + (c.y - s) + ' v ' + (s * 2) +
             ' M ' + (c.x - s * 0.72) + ' ' + (c.y - s * 0.72) + ' L ' + (c.x + s * 0.72) + ' ' + (c.y + s * 0.72) +
             ' M ' + (c.x + s * 0.72) + ' ' + (c.y - s * 0.72) + ' L ' + (c.x - s * 0.72) + ' ' + (c.y + s * 0.72),
          class: 'marcador-gateway grosso'
        }, g);
        break;
      case 'eventBasedGateway':
        u.el('circle', { cx: c.x, cy: c.y, r: s * 1.05, class: 'marcador-gateway sem-preenchimento' }, g);
        u.el('circle', { cx: c.x, cy: c.y, r: s * 0.85, class: 'marcador-gateway sem-preenchimento' }, g);
        var p = [];
        for (var k = 0; k < 5; k++) {
          var ang = -Math.PI / 2 + k * 2 * Math.PI / 5;
          p.push((c.x + Math.cos(ang) * s * 0.6) + ',' + (c.y + Math.sin(ang) * s * 0.6));
        }
        u.el('polygon', { points: p.join(' '), class: 'marcador-gateway sem-preenchimento' }, g);
        break;
    }
    this._rotuloExterno(e, c.x, b.y + b.height + 4);
  };

  Renderer.prototype._dado = function (g, e) {
    var b = e.bounds;
    if (e.tipo === 'dataObjectReference') {
      var dobra = 12;
      u.el('path', {
        d: 'M ' + b.x + ' ' + b.y + ' h ' + (b.width - dobra) + ' l ' + dobra + ' ' + dobra +
           ' v ' + (b.height - dobra) + ' h ' + (-b.width) + ' Z',
        class: 'forma-dado'
      }, g);
      u.el('path', { d: 'M ' + (b.x + b.width - dobra) + ' ' + b.y + ' v ' + dobra + ' h ' + dobra, class: 'forma-dado sem-preenchimento' }, g);
    } else {
      var ry = 6;
      u.el('path', {
        d: 'M ' + b.x + ' ' + (b.y + ry) + ' a ' + (b.width / 2) + ' ' + ry + ' 0 0 1 ' + b.width + ' 0' +
           ' v ' + (b.height - ry * 2) + ' a ' + (b.width / 2) + ' ' + ry + ' 0 0 1 ' + (-b.width) + ' 0 Z',
        class: 'forma-dado'
      }, g);
      u.el('path', { d: 'M ' + b.x + ' ' + (b.y + ry) + ' a ' + (b.width / 2) + ' ' + ry + ' 0 0 0 ' + b.width + ' 0', class: 'forma-dado sem-preenchimento' }, g);
    }
    this._rotuloExterno(e, u.centro(b).x, b.y + b.height + 4);
  };

  Renderer.prototype._anotacao = function (g, e) {
    var b = e.bounds;
    u.el('path', { d: 'M ' + (b.x + 12) + ' ' + b.y + ' h -12 v ' + b.height + ' h 12', class: 'forma-anotacao' }, g);
    var linhas = u.quebrarTexto(e.texto || e.nome, b.width - 20, 11);
    var t = u.el('text', { x: b.x + 17, y: b.y + 14, class: 'rotulo-anotacao' }, g);
    linhas.slice(0, 6).forEach(function (l, i) {
      var ts = u.el('tspan', { x: b.x + 17, dy: i === 0 ? 0 : 13 }, t);
      ts.textContent = l;
    });
  };

  Renderer.prototype._rotuloExterno = function (e, cx, cy) {
    if (!e.nome) return;
    var largura = 140;
    var x = cx, y = cy + 11;
    if (e.labelBounds) {
      largura = Math.max(80, e.labelBounds.width);
      x = e.labelBounds.x + e.labelBounds.width / 2;
      y = e.labelBounds.y + 11;
    }
    var linhas = u.quebrarTexto(e.nome, largura, 11);
    var t = u.el('text', { x: x, y: y, class: 'rotulo-externo', 'data-rotulo-de': e.id }, this.camadas.rotulos);
    linhas.slice(0, 4).forEach(function (l, i) {
      var ts = u.el('tspan', { x: x, dy: i === 0 ? 0 : 12 }, t);
      ts.textContent = l;
    });
  };

  /* ---------------------------------------------------------- fluxos */

  Renderer.prototype.pontosDoFluxo = function (f) {
    var m = this.modelo;
    if (f.waypoints && f.waypoints.length >= 2) return f.waypoints;
    var o = m.elementos[f.origem];
    var a = m.elementos[f.alvo];
    if (!o || !a || !o.bounds || !a.bounds) return null;
    var pts = u.roteamentoOrtogonal(o.bounds, a.bounds);
    pts[0] = ancorar(o, pts[1] || u.centro(a.bounds));
    pts[pts.length - 1] = ancorar(a, pts[pts.length - 2] || u.centro(o.bounds));
    return pts;
  };

  function ancorar(e, alvo) {
    var cat = spec.categoria(e.tipo);
    if (cat === 'evento') return u.ancoraCirculo(e.bounds, alvo);
    if (cat === 'gateway') return u.ancoraLosango(e.bounds, alvo);
    return u.ancoraRetangulo(e.bounds, alvo);
  }

  Renderer.prototype._fluxo = function (f) {
    var pts = this.pontosDoFluxo(f);
    if (!pts || pts.length < 2) return;
    var d = 'M ' + pts.map(function (p) { return p.x + ' ' + p.y; }).join(' L ');
    var classe = 'bpmn-fluxo fluxo-' + f.tipo;
    var g = u.el('g', { class: classe, 'data-id': f.id }, this.camadas.arestas);

    var attrs = { d: d, class: 'linha-fluxo' };
    if (f.tipo === 'sequenceFlow') {
      attrs['marker-end'] = 'url(#seta-sequencia)';
    } else if (f.tipo === 'messageFlow') {
      attrs['marker-end'] = 'url(#seta-mensagem)';
      attrs['marker-start'] = 'url(#inicio-mensagem)';
    } else {
      attrs['marker-end'] = 'url(#seta-associacao)';
    }
    u.el('path', attrs, g);
    u.el('path', { d: d, class: 'linha-fluxo-clique' }, g);

    // marcadores de fluxo padrao / condicional (10.6.1)
    var origem = this.modelo.elementos[f.origem];
    if (f.tipo === 'sequenceFlow' && origem) {
      var p0 = pts[0], p1 = pts[1];
      var ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      var ehPadrao = origem.padrao === f.id;
      if (ehPadrao) {
        var mx = p0.x + Math.cos(ang) * 14;
        var my = p0.y + Math.sin(ang) * 14;
        var pAng = ang - Math.PI / 4;
        u.el('line', {
          x1: mx - Math.cos(pAng) * 6, y1: my - Math.sin(pAng) * 6,
          x2: mx + Math.cos(pAng) * 6, y2: my + Math.sin(pAng) * 6,
          class: 'marca-padrao'
        }, g);
      } else if (f.condicao && spec.ehAtividade(origem.tipo)) {
        var dx = Math.cos(ang), dy = Math.sin(ang);
        var bx = p0.x + dx * 9, by = p0.y + dy * 9;
        u.el('polygon', {
          points: [
            p0.x + ',' + p0.y,
            (bx - dy * 5) + ',' + (by + dx * 5),
            (p0.x + dx * 18) + ',' + (p0.y + dy * 18),
            (bx + dy * 5) + ',' + (by - dx * 5)
          ].join(' '),
          class: 'marca-condicional'
        }, g);
      }
    }

    if (f.nome) {
      var pos = f.labelBounds
        ? { x: f.labelBounds.x + f.labelBounds.width / 2, y: f.labelBounds.y + 10 }
        : (function () { var p = u.pontoNoCaminho(pts, 0.5); return { x: p.x, y: p.y - 6 }; })();
      var linhas = u.quebrarTexto(f.nome, 130, 11);
      var t = u.el('text', { x: pos.x, y: pos.y, class: 'rotulo-fluxo' }, this.camadas.rotulos);
      linhas.slice(0, 3).forEach(function (l, i) {
        var ts = u.el('tspan', { x: pos.x, dy: i === 0 ? 0 : 12 }, t);
        ts.textContent = l;
      });
    }

    this.mapaFluxos[f.id] = g;
    var self = this;
    g.addEventListener('mousedown', function (ev) {
      if (self.aoSelecionar) self.aoSelecionar(f.id, ev);
    });
  };

  /* -------------------------------------------------------- estados */

  Renderer.prototype.limparEstados = function () {
    u.$$('.estado-ativo, .estado-concluido, .estado-erro, .estado-aviso, .estado-selecionado, .estado-percorrido', this.svg)
      .forEach(function (n) {
        n.classList.remove('estado-ativo', 'estado-concluido', 'estado-erro', 'estado-aviso', 'estado-selecionado', 'estado-percorrido');
      });
  };

  Renderer.prototype.marcar = function (id, classe, ligado) {
    var g = this.mapaNos[id] || this.mapaFluxos[id];
    if (!g) return;
    if (ligado === false) g.classList.remove(classe);
    else g.classList.add(classe);
  };

  Renderer.prototype.selecionar = function (ids) {
    var self = this;
    u.$$('.estado-selecionado', this.svg).forEach(function (n) { n.classList.remove('estado-selecionado'); });
    (ids || []).forEach(function (id) { self.marcar(id, 'estado-selecionado'); });
  };

  SB.Renderer = Renderer;
})(window);
