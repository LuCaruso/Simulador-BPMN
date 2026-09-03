/*
 * Motor de simulacao por tokens.
 * Semantica de execucao conforme BPMN 2.0.2:
 *  - 10.6.2 Gateway exclusivo: divergente escolhe UM caminho; convergente
 *           encaminha cada token de entrada SEM sincronizar.
 *  - 10.6.3 Gateway inclusivo: avalia todas as condicoes; convergente
 *           sincroniza os tokens que ainda podem chegar.
 *  - 10.6.4 Gateway paralelo: divergente gera token em TODOS os fluxos de
 *           saida; convergente espera TODOS os fluxos de entrada.
 *  - 10.6.6 Gateway baseado em evento: vence o evento que ocorrer primeiro.
 *  - 10.5.3 Evento de fim com terminacao encerra a instancia.
 *  - 10.5.6 Evento de borda interrompente cancela a atividade anexada.
 */
(function (global) {
  'use strict';
  var SB = global.SB || (global.SB = {});
  var u = SB.util;
  var spec = SB.spec;

  var PADRAO = {
    duracaoMin: 30,
    duracaoMax: 120,
    duracaoEventoMin: 5,
    duracaoEventoMax: 20,
    tempoTransito: 3,
    atrasoMensagemExterna: 20,
    instancias: 1,
    intervaloChegada: 90,
    modoDecisao: 'automatico' // 'automatico' | 'perguntar'
  };

  function Simulador(modelo, cfg) {
    this.modelo = modelo;
    this.cfg = Object.assign({}, PADRAO, cfg || {});
    this.reiniciar();
    this.aoAtualizar = null;   // callback(estado)
    this.aoLogar = null;       // callback(entrada)
    this.aoPerguntar = null;   // callback(gateway, opcoes, escolher)
    this.aoFinalizar = null;
  }

  Simulador.prototype.reiniciar = function () {
    this.tempo = 0;
    this.tokens = [];
    this.instancias = [];
    this.filas = {};              // sincronizacao de gateways
    this.mensagens = {};          // mensagens entregues: "instId|elementoId" -> true
    this.log = [];
    this.stats = {};              // por elemento
    this.statsFluxo = {};         // por fluxo
    this.rodando = false;
    this.pausadoPorPergunta = false;
    this.contadorToken = 0;
    this.contadorInstancia = 0;
    this.proximaChegada = 0;
    this.instanciasCriadas = 0;
    this.encerrado = false;
    this.pendenteDecisao = null;
  };

  /* ------------------------------------------------------- utilitarios */

  Simulador.prototype._stat = function (id) {
    return this.stats[id] || (this.stats[id] = { execucoes: 0, tempoTotal: 0, tempoEspera: 0, ativos: 0 });
  };
  Simulador.prototype._statF = function (id) {
    return this.statsFluxo[id] || (this.statsFluxo[id] = { passagens: 0 });
  };

  Simulador.prototype.registrar = function (tipo, texto, elementoId) {
    var e = { t: this.tempo, tipo: tipo, texto: texto, elementoId: elementoId || null };
    this.log.push(e);
    if (this.log.length > 4000) this.log.splice(0, 1000);
    if (this.aoLogar) this.aoLogar(e);
  };

  Simulador.prototype.duracaoDe = function (el) {
    var s = el.sim || {};
    var cat = spec.categoria(el.tipo);
    var min = s.duracaoMin;
    var max = s.duracaoMax;
    if (min === undefined || isNaN(min)) {
      min = cat === 'evento' ? this.cfg.duracaoEventoMin : this.cfg.duracaoMin;
    }
    if (max === undefined || isNaN(max)) {
      max = cat === 'evento' ? this.cfg.duracaoEventoMax : this.cfg.duracaoMax;
      if (max < min) max = min;
    }
    return u.amostraDuracao(min, max);
  };

  Simulador.prototype.nome = function (id) {
    var e = this.modelo.elementos[id];
    if (!e) return id;
    return e.nome || spec.rotulo(e.tipo);
  };

  /* ---------------------------------------------------------- inicio */

  /** Eventos de inicio elegiveis (processos com participante nao caixa-preta). */
  Simulador.prototype.eventosDeInicio = function () {
    var m = this.modelo;
    var self = this;
    var lista = m.ordem.map(function (id) { return m.elementos[id]; })
      .filter(function (e) {
        if (e.tipo !== 'startEvent') return false;
        if ((e.entradas || []).length) return false;
        var pai = m.elementos[e.pai];
        if (pai && (pai.tipo === 'subProcess' || pai.tipo === 'transaction')) return false;
        return true;
      });
    // Eventos de inicio que sao disparados por uma mensagem vinda de outra
    // piscina do proprio diagrama nao sao a porta de entrada do caso: eles
    // ficam por ultimo, para o padrao cair no inicio "de verdade".
    var derivado = {};
    lista.forEach(function (e) { derivado[e.id] = self.iniciadoPorOutraPiscina(e.id); });
    return lista.slice().sort(function (a, b) {
      return (derivado[a.id] ? 1 : 0) - (derivado[b.id] ? 1 : 0);
    });
  };

  /** O evento de inicio e alvo de fluxo de mensagem vindo de dentro do diagrama? */
  Simulador.prototype.iniciadoPorOutraPiscina = function (noId) {
    var m = this.modelo;
    for (var i = 0; i < m.ordemFluxos.length; i++) {
      var f = m.fluxos[m.ordemFluxos[i]];
      if (f.tipo !== 'messageFlow' || f.alvo !== noId) continue;
      var o = m.elementos[f.origem];
      if (o && o.tipo !== 'participant') return true;   // origem e um elemento modelado
      if (o && o.tipo === 'participant' && o.processRef) return true;
    }
    return false;
  };

  Simulador.prototype.novaInstancia = function (inicioId) {
    var inst = {
      id: 'I' + (++this.contadorInstancia),
      inicio: this.tempo,
      fim: null,
      inicioId: inicioId,
      ativa: true,
      caminho: [],
      cor: corInstancia(this.contadorInstancia)
    };
    this.instancias.push(inst);
    this.instanciasCriadas++;
    this.registrar('instancia', 'Instancia ' + inst.id + ' iniciada em "' + this.nome(inicioId) + '"', inicioId);
    var tk = this.criarToken(inst, inicioId);
    this.chegarEm(tk, inicioId);
    return inst;
  };

  function corInstancia(n) {
    var cores = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
    return cores[(n - 1) % cores.length];
  }

  Simulador.prototype.criarToken = function (inst, noId) {
    var tk = {
      id: 'T' + (++this.contadorToken),
      instId: inst.id,
      cor: inst.cor,
      estado: 'novo',
      noId: noId,
      fluxoId: null,
      progresso: 0,
      duracao: 0,
      restante: 0,
      entrouEm: this.tempo,
      bordas: []
    };
    this.tokens.push(tk);
    return tk;
  };

  Simulador.prototype.removerToken = function (tk) {
    var i = this.tokens.indexOf(tk);
    if (i !== -1) this.tokens.splice(i, 1);
  };

  Simulador.prototype.instancia = function (id) {
    for (var i = 0; i < this.instancias.length; i++) if (this.instancias[i].id === id) return this.instancias[i];
    return null;
  };

  /* -------------------------------------------------------- execucao */

  Simulador.prototype.iniciar = function () {
    if (this.encerrado) this.reiniciar();
    if (!this.instancias.length) {
      var inicios = this.eventosDeInicio();
      if (!inicios.length) {
        this.registrar('erro', 'Nenhum evento de inicio encontrado. Um processo precisa de pelo menos um evento de inicio (BPMN 10.5.2).');
        return false;
      }
      var alvo = this.cfg.eventoInicial && this.modelo.elementos[this.cfg.eventoInicial]
        ? this.cfg.eventoInicial : inicios[0].id;
      this.novaInstancia(alvo);
      this.proximaChegada = this.tempo + this.cfg.intervaloChegada;
    }
    this.rodando = true;
    return true;
  };

  Simulador.prototype.pausar = function () { this.rodando = false; };

  /** Avanca dt segundos simulados. */
  Simulador.prototype.avancar = function (dt) {
    if (!this.rodando || this.pausadoPorPergunta) return;
    var passos = 0;
    var restante = dt;
    // divide em fatias para nao "pular" eventos
    while (restante > 0 && passos < 200) {
      var fatia = Math.min(restante, 1);
      this.tempo += fatia;
      this._passo(fatia);
      restante -= fatia;
      passos++;
      if (this.pausadoPorPergunta) break;
    }

    // chegada de novas instancias
    while (this.rodando && !this.pausadoPorPergunta &&
           this.instanciasCriadas < this.cfg.instancias && this.tempo >= this.proximaChegada) {
      var inicios = this.eventosDeInicio();
      var alvo = this.cfg.eventoInicial && this.modelo.elementos[this.cfg.eventoInicial]
        ? this.cfg.eventoInicial : (inicios[0] && inicios[0].id);
      if (!alvo) break;
      this.novaInstancia(alvo);
      this.proximaChegada += this.cfg.intervaloChegada;
    }

    if (this.tokens.length === 0 && this.instanciasCriadas >= this.cfg.instancias) {
      this.rodando = false;
      this.encerrado = true;
      this.registrar('fim', 'Simulacao concluida. ' + this.instancias.filter(function (i) { return !i.ativa; }).length +
        ' de ' + this.instancias.length + ' instancia(s) finalizada(s).');
      if (this.aoFinalizar) this.aoFinalizar();
    }
    if (this.aoAtualizar) this.aoAtualizar();
  };

  Simulador.prototype._passo = function (dt) {
    var self = this;
    var copia = this.tokens.slice();
    copia.forEach(function (tk) {
      if (self.tokens.indexOf(tk) === -1) return;
      if (tk.estado === 'transito') {
        tk.progresso += tk.duracao > 0 ? dt / tk.duracao : 1;
        if (tk.progresso >= 1) {
          var destino = self.modelo.fluxos[tk.fluxoId].alvo;
          tk.progresso = 1;
          self.chegarEm(tk, destino);
        }
      } else if (tk.estado === 'trabalho') {
        // eventos de borda com temporizador podem interromper
        var interrompeu = false;
        for (var i = 0; i < tk.bordas.length; i++) {
          var bd = tk.bordas[i];
          bd.restante -= dt;
          if (bd.restante <= 0) {
            self.dispararBorda(tk, bd);
            interrompeu = true;
            break;
          }
        }
        if (interrompeu) return;
        tk.restante -= dt;
        if (tk.restante <= 0) self.concluirNo(tk);
      } else if (tk.estado === 'espera-mensagem') {
        tk.restante -= dt;
        self._stat(tk.noId).tempoEspera += dt;
        if (tk.restante <= 0 || self.mensagens[tk.instId + '|' + tk.noId]) {
          delete self.mensagens[tk.instId + '|' + tk.noId];
          self.registrar('mensagem', 'Mensagem recebida em "' + self.nome(tk.noId) + '"', tk.noId);
          self.concluirNo(tk);
        }
      } else if (tk.estado === 'espera-juncao') {
        self._stat(tk.noId).tempoEspera += dt;
        self.tentarJuncao(tk.noId, tk.instId);
      }
    });
  };

  /* ------------------------------------------------------- chegada */

  Simulador.prototype.chegarEm = function (tk, noId) {
    var el = this.modelo.elementos[noId];
    tk.noId = noId;
    tk.fluxoId = null;
    tk.progresso = 0;
    tk.entrouEm = this.tempo;
    tk.bordas = [];
    if (!el) { this.removerToken(tk); return; }

    var inst = this.instancia(tk.instId);
    if (inst && inst.caminho[inst.caminho.length - 1] !== noId) inst.caminho.push(noId);

    var cat = spec.categoria(el.tipo);

    if (cat === 'gateway') {
      this._stat(noId).execucoes++;
      return this.tratarGateway(tk, el);
    }

    if (el.tipo === 'endEvent') {
      this._stat(noId).execucoes++;
      return this.finalizarToken(tk, el);
    }

    if (cat === 'evento') {
      this._stat(noId).execucoes++;
      var def = (el.definicoes && el.definicoes[0]) || 'none';
      var ehCaptura = el.tipo === 'intermediateCatchEvent' || el.tipo === 'startEvent';
      if (el.tipo === 'startEvent') {
        // evento de inicio nao consome tempo: segue adiante
        tk.estado = 'trabalho';
        tk.restante = 0.001;
        return;
      }
      if (ehCaptura && def === 'message') {
        var origemExterna = this.temMensagemDeCaixaPreta(noId);
        tk.estado = 'espera-mensagem';
        tk.restante = origemExterna ? this.cfg.atrasoMensagemExterna : 1e9;
        this.registrar('espera', 'Aguardando mensagem em "' + this.nome(noId) + '"', noId);
        return;
      }
      if (el.tipo === 'intermediateThrowEvent' || def === 'signal' || def === 'escalation') {
        this.emitirMensagens(tk, noId);
      }
      tk.estado = 'trabalho';
      tk.restante = this.duracaoDe(el);
      return;
    }

    if (cat === 'atividade') {
      var st = this._stat(noId);
      st.execucoes++;
      st.ativos++;
      tk.estado = 'trabalho';
      tk.restante = this.duracaoDe(el);
      tk.duracaoTrabalho = tk.restante;
      // eventos de borda
      var self = this;
      (el.bordas || []).forEach(function (bid) {
        var b = self.modelo.elementos[bid];
        if (!b) return;
        var d = (b.definicoes && b.definicoes[0]) || 'none';
        if (d === 'timer') {
          var prazo = self.duracaoDe(b);
          tk.bordas.push({ id: bid, restante: prazo, interrompe: b.cancelActivity !== false });
        }
      });
      this.registrar('atividade', 'Iniciou "' + this.nome(noId) + '" (' + u.formatarDuracao(tk.restante) + ')', noId);
      return;
    }

    // dados/artefatos nao recebem token
    tk.estado = 'trabalho';
    tk.restante = 0.001;
  };

  Simulador.prototype.temMensagemDeCaixaPreta = function (noId) {
    var m = this.modelo;
    for (var i = 0; i < m.ordemFluxos.length; i++) {
      var f = m.fluxos[m.ordemFluxos[i]];
      if (f.tipo !== 'messageFlow' || f.alvo !== noId) continue;
      var o = m.elementos[f.origem];
      if (!o) continue;
      if (o.tipo === 'participant' && !o.processRef) return true;
      if (o.tipo === 'participant') return true;
    }
    return false;
  };

  /** O elemento e origem de algum fluxo de mensagem? */
  Simulador.prototype.temMensagemDeSaida = function (noId) {
    var m = this.modelo;
    for (var i = 0; i < m.ordemFluxos.length; i++) {
      var f = m.fluxos[m.ordemFluxos[i]];
      if (f.tipo === 'messageFlow' && f.origem === noId) return true;
    }
    return false;
  };

  Simulador.prototype.emitirMensagens = function (tk, noId) {
    var m = this.modelo;
    var self = this;
    m.ordemFluxos.forEach(function (fid) {
      var f = m.fluxos[fid];
      if (f.tipo !== 'messageFlow' || f.origem !== noId) return;
      self._statF(fid).passagens++;
      var alvo = m.elementos[f.alvo];
      if (alvo && alvo.tipo === 'startEvent' && !(alvo.entradas || []).length) {
        // Mensagem que INICIA o processo da outra piscina (BPMN 10.5.2):
        // gera um novo token no evento de inicio. O token fica na mesma
        // instancia, para que o caso continue sendo um unico atendimento
        // ponta a ponta atravessando as duas piscinas.
        var inst = self.instancia(tk.instId) || { id: tk.instId, cor: tk.cor };
        var disparado = self.criarToken(inst, alvo.id);
        self.registrar('mensagem', 'Mensagem "' + (f.nome || 'sem nome') + '" iniciou "' +
          self.nome(alvo.id) + '"', fid);
        self.chegarEm(disparado, alvo.id);
        return;
      }
      if (alvo && alvo.tipo !== 'participant') {
        self.mensagens[tk.instId + '|' + f.alvo] = true;
      }
      self.registrar('mensagem', 'Mensagem "' + (f.nome || 'sem nome') + '" enviada de "' + self.nome(noId) + '"', fid);
    });
  };

  /* ------------------------------------------------------ conclusao */

  Simulador.prototype.concluirNo = function (tk) {
    var el = this.modelo.elementos[tk.noId];
    if (!el) { this.removerToken(tk); return; }
    var st = this._stat(tk.noId);
    var gasto = this.tempo - tk.entrouEm;
    st.tempoTotal += Math.max(0, gasto);
    if (spec.categoria(el.tipo) === 'atividade') {
      st.ativos = Math.max(0, st.ativos - 1);
      this.registrar('atividade', 'Concluiu "' + this.nome(tk.noId) + '"', tk.noId);
      // Toda atividade com fluxo de mensagem de saida envia a mensagem ao
      // concluir (BPMN 7.6.2 / Tabela 7.4), nao so a tarefa de envio.
      if (this.temMensagemDeSaida(tk.noId)) this.emitirMensagens(tk, tk.noId);
    }
    this.sairDe(tk, el);
  };

  Simulador.prototype.sairDe = function (tk, el) {
    var saidas = (el.saidas || []).slice();
    if (!saidas.length) {
      // sem fluxo de saida: token morre (fim implicito)
      this.registrar('aviso', '"' + this.nome(el.id) + '" nao possui fluxo de saida; token encerrado.', el.id);
      this.removerToken(tk);
      this.verificarFimInstancia(tk.instId);
      return;
    }
    this.enviarPor(tk, saidas[0]);
    for (var i = 1; i < saidas.length; i++) {
      var novo = this.criarToken(this.instancia(tk.instId) || { id: tk.instId, cor: tk.cor }, el.id);
      this.enviarPor(novo, saidas[i]);
    }
  };

  Simulador.prototype.enviarPor = function (tk, fluxoId) {
    var f = this.modelo.fluxos[fluxoId];
    if (!f) { this.removerToken(tk); return; }
    this._statF(fluxoId).passagens++;
    tk.estado = 'transito';
    tk.fluxoId = fluxoId;
    tk.progresso = 0;
    tk.duracao = Math.max(0.2, this.cfg.tempoTransito);
    tk.noId = null;
  };

  /* -------------------------------------------------------- gateways */

  Simulador.prototype.tratarGateway = function (tk, gw) {
    var entradas = (gw.entradas || []).length;
    var saidas = (gw.saidas || []);

    // convergencia
    if (entradas > 1) {
      if (gw.tipo === 'parallelGateway' || gw.tipo === 'inclusiveGateway' || gw.tipo === 'complexGateway') {
        var chave = gw.id + '|' + tk.instId;
        var fila = this.filas[chave] || (this.filas[chave] = { fluxos: {}, tokens: [] });
        var origemFluxo = tk.ultimoFluxo || null;
        fila.tokens.push(tk);
        tk.estado = 'espera-juncao';
        tk.noId = gw.id;
        this.registrar('juncao', 'Token aguardando sincronizacao em "' + this.nome(gw.id) + '" (' +
          fila.tokens.length + '/' + entradas + ')', gw.id);
        this.tentarJuncao(gw.id, tk.instId);
        return;
      }
      // exclusivo: passa direto (10.6.2 - sem sincronizacao)
    }

    if (!saidas.length) {
      this.registrar('aviso', 'Gateway "' + this.nome(gw.id) + '" sem fluxo de saida.', gw.id);
      this.removerToken(tk);
      this.verificarFimInstancia(tk.instId);
      return;
    }
    this.divergir(tk, gw, saidas);
  };

  Simulador.prototype.tentarJuncao = function (gwId, instId) {
    var gw = this.modelo.elementos[gwId];
    var chave = gwId + '|' + instId;
    var fila = this.filas[chave];
    if (!fila || !fila.tokens.length) return;
    var necessarios = (gw.entradas || []).length;

    var pronto = false;
    if (gw.tipo === 'parallelGateway') {
      pronto = fila.tokens.length >= necessarios;
    } else {
      // inclusivo/complexo: libera quando nenhum outro token da instancia
      // ainda pode alcancar este gateway (10.6.3)
      pronto = fila.tokens.length >= necessarios || !this.algumTokenPodeAlcancar(gwId, instId, fila.tokens);
    }
    if (!pronto) return;

    var sobrevivente = fila.tokens[0];
    for (var i = 1; i < fila.tokens.length; i++) this.removerToken(fila.tokens[i]);
    delete this.filas[chave];
    this.registrar('juncao', 'Sincronizacao concluida em "' + this.nome(gwId) + '"', gwId);

    var saidas = (gw.saidas || []);
    if (!saidas.length) {
      this.removerToken(sobrevivente);
      this.verificarFimInstancia(instId);
      return;
    }
    this.divergir(sobrevivente, gw, saidas);
  };

  /** Ha token da instancia (fora da fila) capaz de chegar ao gateway? */
  Simulador.prototype.algumTokenPodeAlcancar = function (gwId, instId, naFila) {
    var m = this.modelo;
    var self = this;
    var candidatos = this.tokens.filter(function (t) {
      return t.instId === instId && naFila.indexOf(t) === -1;
    });
    if (!candidatos.length) return false;
    for (var i = 0; i < candidatos.length; i++) {
      var origem = candidatos[i].noId || (candidatos[i].fluxoId ? m.fluxos[candidatos[i].fluxoId].alvo : null);
      if (!origem) continue;
      if (self.alcanca(origem, gwId)) return true;
    }
    return false;
  };

  Simulador.prototype.alcanca = function (deId, ateId) {
    var m = this.modelo;
    var visitados = {};
    var pilha = [deId];
    while (pilha.length) {
      var atual = pilha.pop();
      if (atual === ateId) return true;
      if (visitados[atual]) continue;
      visitados[atual] = true;
      var el = m.elementos[atual];
      if (!el) continue;
      (el.saidas || []).forEach(function (fid) {
        var alvo = m.fluxos[fid].alvo;
        if (!visitados[alvo]) pilha.push(alvo);
      });
      (el.bordas || []).forEach(function (bid) {
        if (!visitados[bid]) pilha.push(bid);
      });
    }
    return false;
  };

  Simulador.prototype.divergir = function (tk, gw, saidas) {
    var self = this;
    if (saidas.length === 1) return this.enviarPor(tk, saidas[0]);

    if (gw.tipo === 'parallelGateway') {
      this.registrar('gateway', 'Gateway paralelo "' + this.nome(gw.id) + '" gerou ' + saidas.length + ' caminhos.', gw.id);
      this.enviarPor(tk, saidas[0]);
      for (var i = 1; i < saidas.length; i++) {
        var novo = this.criarToken(this.instancia(tk.instId) || { id: tk.instId, cor: tk.cor }, gw.id);
        this.enviarPor(novo, saidas[i]);
      }
      return;
    }

    if (gw.tipo === 'eventBasedGateway') {
      // vence o evento que ocorreria primeiro (10.6.6)
      var melhor = null, melhorT = Infinity;
      saidas.forEach(function (fid) {
        var alvo = self.modelo.elementos[self.modelo.fluxos[fid].alvo];
        var t = alvo ? self.duracaoDe(alvo) : Infinity;
        if (alvo && spec.temDef(alvo.definicoes, 'message') && self.temMensagemDeCaixaPreta(alvo.id)) {
          t = u.amostraDuracao(self.cfg.atrasoMensagemExterna * 0.4, self.cfg.atrasoMensagemExterna * 1.6);
        }
        if (t < melhorT) { melhorT = t; melhor = fid; }
      });
      var alvoNome = this.nome(this.modelo.fluxos[melhor].alvo);
      this.registrar('gateway', 'Gateway por evento "' + this.nome(gw.id) + '": venceu "' + alvoNome + '".', gw.id);
      return this.enviarPor(tk, melhor);
    }

    if (gw.tipo === 'inclusiveGateway') {
      if (this.cfg.modoDecisao === 'perguntar' && this.aoPerguntar) {
        this.pausadoPorPergunta = true;
        this.pendenteDecisao = { gw: gw, tk: tk, saidas: saidas };
        this.aoPerguntar(gw, this.opcoesDe(gw, saidas), function (ids) { self.responderDecisao(ids); }, { multiplo: true });
        return;
      }
      var escolhidos = saidas.filter(function (fid) { return Math.random() < probabilidadeDe(self.modelo, fid, saidas); });
      if (!escolhidos.length) escolhidos = [gw.padrao && saidas.indexOf(gw.padrao) !== -1 ? gw.padrao : saidas[0]];
      this.registrar('gateway', 'Gateway inclusivo "' + this.nome(gw.id) + '": ' + escolhidos.length + ' caminho(s).', gw.id);
      this.enviarPor(tk, escolhidos[0]);
      for (var j = 1; j < escolhidos.length; j++) {
        var n2 = this.criarToken(this.instancia(tk.instId) || { id: tk.instId, cor: tk.cor }, gw.id);
        this.enviarPor(n2, escolhidos[j]);
      }
      return;
    }

    // exclusivo (e complexo, simplificado): escolhe um caminho
    if (this.cfg.modoDecisao === 'perguntar' && this.aoPerguntar) {
      this.pausadoPorPergunta = true;
      this.pendenteDecisao = { gw: gw, tk: tk, saidas: saidas };
      this.aoPerguntar(gw, this.opcoesDe(gw, saidas), function (fid) { self.responderDecisao(fid); });
      return;
    }
    var sorteado = sortearPonderado(this.modelo, saidas, gw.padrao);
    this.registrar('gateway', 'Gateway exclusivo "' + this.nome(gw.id) + '": seguiu "' +
      (this.modelo.fluxos[sorteado].nome || this.nome(this.modelo.fluxos[sorteado].alvo)) + '".', gw.id);
    this.enviarPor(tk, sorteado);
  };

  /** Descreve os caminhos de saida de um gateway para a caixa de decisao. */
  Simulador.prototype.opcoesDe = function (gw, saidas) {
    var self = this;
    return saidas.map(function (fid) {
      var f = self.modelo.fluxos[fid];
      return {
        id: fid,
        rotulo: f.nome || f.condicao || ('-> ' + self.nome(f.alvo)),
        alvo: self.nome(f.alvo),
        padrao: gw.padrao === fid
      };
    });
  };

  /** Recebe a escolha do usuario: um id de fluxo ou uma lista deles (inclusivo). */
  Simulador.prototype.responderDecisao = function (escolha) {
    var p = this.pendenteDecisao;
    if (!p) return;
    var ids = Array.isArray(escolha) ? escolha.slice() : [escolha];
    ids = ids.filter(function (id) { return p.saidas.indexOf(id) !== -1; });
    if (!ids.length) ids = [p.padrao && p.saidas.indexOf(p.padrao) !== -1 ? p.padrao : p.saidas[0]];

    this.pendenteDecisao = null;
    this.pausadoPorPergunta = false;

    var self = this;
    this.registrar('gateway', 'Decisao manual em "' + this.nome(p.gw.id) + '": ' +
      ids.map(function (id) {
        var f = self.modelo.fluxos[id];
        return f.nome || self.nome(f.alvo);
      }).join(' + '), p.gw.id);

    this.enviarPor(p.tk, ids[0]);
    for (var i = 1; i < ids.length; i++) {
      var novo = this.criarToken(this.instancia(p.tk.instId) || { id: p.tk.instId, cor: p.tk.cor }, p.gw.id);
      this.enviarPor(novo, ids[i]);
    }
  };

  function probabilidadeDe(m, fid, saidas) {
    var f = m.fluxos[fid];
    var p = f.sim && f.sim.probabilidade;
    if (p === undefined || isNaN(p)) return 0.5;
    return Math.max(0, Math.min(1, p / 100));
  }

  function sortearPonderado(m, saidas, padraoId) {
    var pesos = saidas.map(function (fid) {
      var f = m.fluxos[fid];
      var p = f.sim && f.sim.probabilidade;
      return (p === undefined || isNaN(p)) ? null : Math.max(0, p);
    });
    var definidos = pesos.filter(function (p) { return p !== null; });
    if (!definidos.length) {
      return saidas[Math.floor(Math.random() * saidas.length)];
    }
    var somaDef = definidos.reduce(function (a, b) { return a + b; }, 0);
    var nNulos = pesos.filter(function (p) { return p === null; }).length;
    var resto = Math.max(0, 100 - somaDef);
    var finais = pesos.map(function (p) { return p === null ? (nNulos ? resto / nNulos : 0) : p; });
    var total = finais.reduce(function (a, b) { return a + b; }, 0);
    if (total <= 0) return padraoId && saidas.indexOf(padraoId) !== -1 ? padraoId : saidas[0];
    var r = Math.random() * total;
    for (var i = 0; i < saidas.length; i++) {
      r -= finais[i];
      if (r <= 0) return saidas[i];
    }
    return saidas[saidas.length - 1];
  }

  /* --------------------------------------------------- borda e fim */

  Simulador.prototype.dispararBorda = function (tk, bd) {
    var b = this.modelo.elementos[bd.id];
    this._stat(bd.id).execucoes++;
    this.registrar('borda', 'Evento de borda "' + this.nome(bd.id) + '" disparou em "' + this.nome(tk.noId) + '".', bd.id);
    if (bd.interrompe) {
      var st = this._stat(tk.noId);
      st.ativos = Math.max(0, st.ativos - 1);
      tk.bordas = [];
      tk.noId = bd.id;
      this.sairDe(tk, b);
    } else {
      var novo = this.criarToken(this.instancia(tk.instId) || { id: tk.instId, cor: tk.cor }, bd.id);
      bd.restante = Infinity;
      this.sairDe(novo, b);
    }
  };

  Simulador.prototype.finalizarToken = function (tk, el) {
    var def = (el.definicoes && el.definicoes[0]) || 'none';
    if (spec.temDef(el.definicoes, 'message')) this.emitirMensagens(tk, el.id);
    this.registrar('fim', 'Token chegou ao fim "' + this.nome(el.id) + '" (' + (SB.spec.DEFINICOES[def] || {}).rotulo + ')', el.id);
    var instId = tk.instId;
    this.removerToken(tk);
    if (def === 'terminate') {
      var self = this;
      this.tokens.slice().forEach(function (t) { if (t.instId === instId) self.removerToken(t); });
      Object.keys(this.filas).forEach(function (k) { if (k.indexOf('|' + instId) !== -1) delete self.filas[k]; });
      this.registrar('fim', 'Evento de terminacao encerrou a instancia ' + instId + '.', el.id);
    }
    this.verificarFimInstancia(instId);
  };

  Simulador.prototype.verificarFimInstancia = function (instId) {
    var vivos = this.tokens.filter(function (t) { return t.instId === instId; }).length;
    if (vivos > 0) return;
    var inst = this.instancia(instId);
    if (inst && inst.ativa) {
      inst.ativa = false;
      inst.fim = this.tempo;
      this.registrar('instancia', 'Instancia ' + instId + ' concluida em ' + u.formatarDuracao(inst.fim - inst.inicio) + '.');
    }
  };

  /* ---------------------------------------------------- estatisticas */

  Simulador.prototype.resumo = function () {
    var concluidas = this.instancias.filter(function (i) { return !i.ativa; });
    var ciclos = concluidas.map(function (i) { return i.fim - i.inicio; });
    var media = ciclos.length ? ciclos.reduce(function (a, b) { return a + b; }, 0) / ciclos.length : 0;
    var min = ciclos.length ? Math.min.apply(null, ciclos) : 0;
    var max = ciclos.length ? Math.max.apply(null, ciclos) : 0;

    var m = this.modelo;
    var self = this;
    var porElemento = Object.keys(this.stats).map(function (id) {
      var s = self.stats[id];
      var el = m.elementos[id];
      return {
        id: id,
        nome: self.nome(id),
        tipo: el ? el.tipo : '?',
        categoria: el ? spec.categoria(el.tipo) : '?',
        execucoes: s.execucoes,
        tempoTotal: s.tempoTotal,
        tempoMedio: s.execucoes ? s.tempoTotal / s.execucoes : 0,
        tempoEspera: s.tempoEspera,
        custo: el && el.sim && el.sim.custo ? el.sim.custo * s.execucoes : 0
      };
    }).sort(function (a, b) { return b.tempoTotal - a.tempoTotal; });

    var custoTotal = porElemento.reduce(function (a, b) { return a + (b.custo || 0); }, 0);
    var trabalho = porElemento.filter(function (e) { return e.categoria === 'atividade'; })
      .reduce(function (a, b) { return a + b.tempoTotal; }, 0);
    var espera = porElemento.reduce(function (a, b) { return a + b.tempoEspera; }, 0);

    return {
      tempo: this.tempo,
      criadas: this.instancias.length,
      concluidas: concluidas.length,
      ativas: this.instancias.filter(function (i) { return i.ativa; }).length,
      tokensAtivos: this.tokens.length,
      cicloMedio: media,
      cicloMin: min,
      cicloMax: max,
      trabalho: trabalho,
      espera: espera,
      custoTotal: custoTotal,
      porElemento: porElemento,
      porFluxo: this.statsFluxo
    };
  };

  Simulador.PADRAO = PADRAO;
  SB.Simulador = Simulador;
})(window);
