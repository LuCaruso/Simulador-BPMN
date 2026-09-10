/* Simulador BPMN - aplicacao principal (integra parser, render, editor e simulador). */
(function (global) {
  'use strict';
  var SB = global.SB;
  var u = SB.util;
  var spec = SB.spec;
  var $ = u.$;

  var App = {
    modelo: null,
    nomeArquivo: null,
    alterado: false,
    r: null,
    editor: null,
    sim: null,
    fixarPaleta: false,
    aba: 'simulacao',
    mapaCalor: false,
    ultimoFrame: 0,
    animando: false,
    velocidade: 20 // segundos simulados por segundo real
  };
  global.App = App;

  /* ================================================================ init */

  function iniciar() {
    App.r = new SB.Renderer($('#canvas'));
    App.editor = new SB.Editor(App.r, App);
    iniciarTema();
    montarPaleta();
    ligarUI();
    ligarArrastarSoltar();
    ligarBoasVindas();
    carregarListaArquivos();
    var m = SB.Editor.modeloVazio(true);
    App.definirModelo(m, { semSnapshot: true, nome: null });
    setTimeout(function () { App.r.ajustarNaTela(); }, 50);
    App.atualizarAcoesDependentes();
    App.abrirBoasVindas(false);
    laco();
  }

  /* ============================================================== tema */

  var CHAVE_TEMA = 'simuladorBpmn.tema';

  /** Preferencia salva: 'light' | 'dark' | 'sistema'. */
  App.preferenciaTema = function () {
    try { return localStorage.getItem(CHAVE_TEMA) || 'sistema'; }
    catch (e) { return 'sistema'; }
  };

  /** Tema efetivamente aplicado: 'light' | 'dark'. */
  App.temaAtual = function () {
    return document.documentElement.getAttribute('data-tema') === 'dark' ? 'dark' : 'light';
  };

  function sistemaEscuro() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  App.definirTema = function (preferencia, silencioso) {
    var p = ['light', 'dark', 'sistema'].indexOf(preferencia) !== -1 ? preferencia : 'sistema';
    try { localStorage.setItem(CHAVE_TEMA, p); } catch (e) { /* modo privado */ }
    var efetivo = p === 'sistema' ? (sistemaEscuro() ? 'dark' : 'light') : p;
    var raiz = document.documentElement;
    raiz.classList.add('trocando-tema');
    raiz.setAttribute('data-tema', efetivo);
    // remove no proximo quadro: a troca fica instantanea, sem transicoes parciais
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { raiz.classList.remove('trocando-tema'); });
    });
    u.$$('#tema-controle button').forEach(function (b) {
      b.classList.toggle('ativo', b.getAttribute('data-tema-opcao') === p);
    });
    if (App.mapaCalor) App.redesenhar();
    if (!silencioso) {
      App.mostrarDica('Tema: ' + (p === 'sistema' ? 'acompanhando o sistema (' + efetivo + ')'
        : (p === 'dark' ? 'escuro' : 'claro')) + '.');
    }
  };

  function iniciarTema() {
    App.definirTema(App.preferenciaTema(), true);
    u.$$('#tema-controle button').forEach(function (b) {
      b.addEventListener('click', function () { App.definirTema(b.getAttribute('data-tema-opcao')); });
    });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var aoMudar = function () {
        if (App.preferenciaTema() === 'sistema') App.definirTema('sistema', true);
      };
      if (mq.addEventListener) mq.addEventListener('change', aoMudar);
      else if (mq.addListener) mq.addListener(aoMudar);
    }
  }

  /* ============================================================ modelo */

  App.definirModelo = function (m, op) {
    op = op || {};
    App.modelo = m;
    SB.layout.garantirGeometria(m);
    SB.parser.indexar(m);
    if (op.nome !== undefined) App.nomeArquivo = op.nome;
    App.sim = new SB.Simulador(m, lerConfigSim());
    ligarSimulador();
    App.editor.selecao = [];
    if (!op.semSnapshot) App.editor.historico.length = 0;
    App.redesenhar();
    App.r.ajustarNaTela();
    preencherEventosIniciais();
    App.renderValidacao();
    App.renderEstatisticas();
    atualizarStatus();
  };

  App.marcarAlterado = function () {
    App.alterado = true;
    atualizarStatus();
    App.renderValidacao();
  };

  App.redesenhar = function (op) {
    op = op || {};
    App.r.render(App.modelo);
    App.editor.desenharAuxiliares();
    if (App.mapaCalor) aplicarMapaCalor();
    desenharTokens();
    if (!op.leve) atualizarStatus();
  };

  App.atualizarBotoesHistorico = function () {
    $('#btn-desfazer').disabled = !App.editor.historico.length;
    $('#btn-refazer').disabled = !App.editor.futuro.length;
  };

  /* =========================================================== arquivos */

  function carregarListaArquivos() {
    fetch('/api/diagramas')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var sel = $('#lista-arquivos');
        sel.innerHTML = '';
        sel.appendChild(u.h('option', { value: '', text: '-- diagramas da pasta /diagramas --' }));
        (d.arquivos || []).forEach(function (a) {
          sel.appendChild(u.h('option', { value: a.nome, text: a.nome + '  (' + Math.round(a.tamanho / 1024) + ' KB)' }));
        });
      })
      .catch(function () { /* servidor pode estar offline */ });
  }

  function abrirDoServidor(nome) {
    if (!nome) return;
    fetch('/api/diagrama?nome=' + encodeURIComponent(nome))
      .then(function (r) {
        if (!r.ok) return r.json().then(function (j) { throw new Error(j.erro || 'falha'); });
        return r.text();
      })
      .then(function (xml) { carregarXml(xml, nome); })
      .catch(function (e) { App.mostrarDica('Nao foi possivel abrir: ' + e.message, 'erro'); });
  }

  function carregarXml(xml, nome) {
    try {
      var m = SB.parser.analisar(xml);
      App.definirModelo(m, { nome: nome });
      App.alterado = false;
      atualizarStatus();
      var qtd = m.ordem.length;
      App.mostrarDica('Diagrama carregado: ' + qtd + ' elementos, ' + m.ordemFluxos.length + ' fluxos.');
      (m.avisosLeitura || []).forEach(function (a) { App.mostrarDica(a, 'aviso'); });
      irParaAba('simulacao');
    } catch (e) {
      App.mostrarDica('Erro ao ler o arquivo: ' + e.message, 'erro');
    }
  }

  function salvarNoServidor() {
    var nome = App.nomeArquivo;
    if (!nome) {
      nome = prompt('Nome do arquivo (.bpmn):', sugerirNome());
      if (!nome) return;
      if (!/\.bpmn$/i.test(nome)) nome += '.bpmn';
    }
    var xml = SB.serializer.gerar(App.modelo);
    fetch('/api/diagrama', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: nome, xml: xml })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.erro) throw new Error(d.erro);
        App.nomeArquivo = d.nome;
        App.alterado = false;
        atualizarStatus();
        carregarListaArquivos();
        App.mostrarDica('Salvo em /diagramas/' + d.nome + (d.sobrescrito ? ' (versao anterior em /diagramas/_backup)' : ''));
      })
      .catch(function (e) { App.mostrarDica('Falha ao salvar: ' + e.message, 'erro'); });
  }

  App.salvar = function () { salvarNoServidor(); };

  function sugerirNome() {
    var base = (App.modelo && App.modelo.nome ? App.modelo.nome : 'diagrama')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return (base || 'diagrama') + '.bpmn';
  }

  function baixar(nomeArq, conteudo, tipo) {
    var blob = new Blob([conteudo], { type: tipo });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nomeArq;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /** Le os tokens --dg-* de um tema, mesmo que nao seja o tema ativo. */
  var TOKENS_DIAGRAMA = [
    '--dg-fundo', '--dg-grade', '--dg-forma', '--dg-forma-2', '--dg-traco', '--dg-traco-fraco',
    '--dg-texto', '--dg-texto-fraco', '--dg-inicio', '--dg-interm', '--dg-fim',
    '--dg-gateway-fundo', '--dg-gateway-traco', '--dg-fluxo', '--dg-mensagem', '--dg-assoc',
    '--dg-ativo', '--dg-espera', '--dg-selecao'
  ];
  function tokensDoTema(tema) {
    var sonda = document.createElement('div');
    sonda.setAttribute('data-tema', tema);
    sonda.style.display = 'none';
    document.body.appendChild(sonda);
    var cs = getComputedStyle(sonda);
    var out = {};
    TOKENS_DIAGRAMA.forEach(function (n) { out[n] = (cs.getPropertyValue(n) || '').trim(); });
    sonda.remove();
    return out;
  }

  /**
   * Gera um SVG autonomo do diagrama. A exportacao sai sempre no TEMA CLARO
   * (fundo branco), que e o esperado para impressao, relatorios e slides.
   */
  function svgAutonomo() {
    var lim = SB.layout.limites(App.modelo);
    var pad = 30;
    var clone = App.r.svg.cloneNode(true);
    u.$$('.aux-edicao, .camada-overlay *', clone).forEach(function (n) { n.remove(); });
    u.$$('.estado-ativo, .estado-espera, .estado-selecionado', clone).forEach(function (n) {
      n.classList.remove('estado-ativo', 'estado-espera', 'estado-selecionado');
    });
    // o mapa de calor grava fill inline; remove para nao contaminar a exportacao
    u.$$('[style]', clone).forEach(function (n) {
      if (n.style && n.style.fill) n.style.fill = '';
    });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', Math.round(lim.width + pad * 2));
    clone.setAttribute('height', Math.round(lim.height + pad * 2));
    clone.setAttribute('viewBox', [Math.round(lim.x - pad), Math.round(lim.y - pad),
      Math.round(lim.width + pad * 2), Math.round(lim.height + pad * 2)].join(' '));
    var vp = clone.querySelector('.viewport');
    if (vp) vp.removeAttribute('transform');
    // tokens do tema claro embutidos na raiz do SVG exportado
    var claros = tokensDoTema('light');
    var decl = TOKENS_DIAGRAMA.map(function (n) { return '  ' + n + ': ' + (claros[n] || '#000') + ';'; }).join('\n');
    var estilo = document.createElementNS(u.SVG_NS, 'style');
    estilo.textContent = 'svg {\n' + decl +
      '\n  font-family: Inter, "Segoe UI", Roboto, Arial, sans-serif;\n}\n' + cssDoDiagrama();
    clone.insertBefore(estilo, clone.firstChild);
    var fundo = document.createElementNS(u.SVG_NS, 'rect');
    fundo.setAttribute('x', Math.round(lim.x - pad));
    fundo.setAttribute('y', Math.round(lim.y - pad));
    fundo.setAttribute('width', Math.round(lim.width + pad * 2));
    fundo.setAttribute('height', Math.round(lim.height + pad * 2));
    fundo.setAttribute('fill', '#ffffff');
    clone.insertBefore(fundo, estilo.nextSibling);
    return new XMLSerializer().serializeToString(clone);
  }

  function cssDoDiagrama() {
    var out = [];
    for (var i = 0; i < document.styleSheets.length; i++) {
      var ss = document.styleSheets[i];
      var regras;
      try { regras = ss.cssRules; } catch (e) { continue; }
      for (var j = 0; j < regras.length; j++) {
        var t = regras[j].cssText;
        // os tokens de tema sao injetados a parte; aqui vao so as regras de desenho
        if (/\[data-tema|^:root|@font-face|@import/.test(t)) continue;
        if (/forma-|rotulo-|marcador-|simbolo-|linha-fluxo|marca-padrao|marca-condicional|bpmn-|token|barra-progresso/.test(t)) out.push(t);
      }
    }
    return out.join('\n');
  }

  function exportarPng() {
    var svgTexto = svgAutonomo();
    var img = new Image();
    var blob = new Blob([svgTexto], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    img.onload = function () {
      var escala = 2;
      var cv = document.createElement('canvas');
      cv.width = img.width * escala;
      cv.height = img.height * escala;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob(function (b) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = sugerirNome().replace(/\.bpmn$/, '') + '.png';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
      });
      URL.revokeObjectURL(url);
    };
    img.onerror = function () { App.mostrarDica('Nao foi possivel gerar o PNG.', 'erro'); };
    img.src = url;
  }

  /* ============================================================ paleta */

  function montarPaleta() {
    var cont = $('#paleta');
    cont.innerHTML = '';
    spec.PALETA.forEach(function (g) {
      var secao = u.h('div', { class: 'paleta-secao', 'data-grupo': g.grupo });
      var cabecalho = u.h('button', { class: 'paleta-grupo', type: 'button' }, [
        u.h('span', { class: 'paleta-seta', text: '▾' }),
        u.h('span', { text: g.grupo })
      ]);
      var grade = u.h('div', { class: 'paleta-grade' });
      cabecalho.addEventListener('click', function () { secao.classList.toggle('recolhida'); });

      g.itens.forEach(function (it) {
        var descricao = it.rotulo + '  —  ' + spec.rotulo(it.tipo) +
          '\nClique e depois clique no diagrama, ou arraste direto para o diagrama.';
        var btn = u.h('button', {
          class: 'paleta-item', title: descricao, draggable: 'true',
          'data-tipo': it.tipo, 'data-def': it.def || '', 'data-busca': (it.rotulo + ' ' + spec.rotulo(it.tipo)).toLowerCase()
        }, [iconePaleta(it), u.h('span', { class: 'paleta-rotulo', text: it.rotulo })]);

        btn.addEventListener('click', function () {
          var jaAtivo = btn.classList.contains('ativo');
          u.$$('.paleta-item').forEach(function (b) { b.classList.remove('ativo'); });
          if (jaAtivo) {
            App.editor.definirModo('selecionar');
            return;
          }
          btn.classList.add('ativo');
          App.editor.definirModo('criar', it.tipo, it.def);
          App.mostrarDica('Agora clique no diagrama para posicionar: ' + it.rotulo);
        });

        // arrastar direto da paleta para o diagrama
        btn.addEventListener('dragstart', function (ev) {
          ev.dataTransfer.effectAllowed = 'copy';
          ev.dataTransfer.setData('text/plain', it.tipo + '|' + (it.def || ''));
          App._arrastandoPaleta = { tipo: it.tipo, def: it.def || null };
          btn.classList.add('arrastando');
        });
        btn.addEventListener('dragend', function () {
          btn.classList.remove('arrastando');
          App._arrastandoPaleta = null;
        });

        grade.appendChild(btn);
      });

      secao.appendChild(cabecalho);
      secao.appendChild(grade);
      cont.appendChild(secao);
    });
  }

  /** Filtra a paleta pelo texto digitado. */
  function filtrarPaleta(texto) {
    var q = String(texto || '').trim().toLowerCase();
    u.$$('.paleta-secao').forEach(function (secao) {
      var visiveis = 0;
      u.$$('.paleta-item', secao).forEach(function (it) {
        var bate = !q || (it.getAttribute('data-busca') || '').indexOf(q) !== -1;
        it.classList.toggle('oculto', !bate);
        if (bate) visiveis++;
      });
      secao.classList.toggle('oculto', visiveis === 0);
      if (q) secao.classList.remove('recolhida');
    });
    $('#paleta-vazia').classList.toggle('oculto', u.$$('.paleta-item:not(.oculto)').length > 0);
  }

  /** Recebe o elemento arrastado da paleta e cria no ponto solto. */
  function ligarArrastarSoltar() {
    var svg = $('#canvas');
    svg.addEventListener('dragover', function (ev) {
      if (!App._arrastandoPaleta) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
      svg.classList.add('recebendo');
    });
    svg.addEventListener('dragleave', function () { svg.classList.remove('recebendo'); });
    svg.addEventListener('drop', function (ev) {
      svg.classList.remove('recebendo');
      var dados = App._arrastandoPaleta;
      if (!dados) {
        var txt = ev.dataTransfer.getData('text/plain') || '';
        if (txt.indexOf('|') === -1) return;
        dados = { tipo: txt.split('|')[0], def: txt.split('|')[1] || null };
      }
      ev.preventDefault();
      if (!App.editor.habilitado) {
        App.mostrarDica('Pare a simulacao para editar o diagrama.', 'aviso');
        return;
      }
      var p = App.r.paraDiagrama(ev.clientX, ev.clientY);
      App.editor.definirModo('criar', dados.tipo, dados.def);
      App.editor.criarNoPonto(p);
      App.editor.definirModo('selecionar');
      u.$$('.paleta-item').forEach(function (b) { b.classList.remove('ativo'); });
    });
  }

  function iconePaleta(it) {
    var svg = document.createElementNS(u.SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.setAttribute('class', 'icone-paleta');
    var falso = {
      id: 'x', tipo: it.tipo, nome: '',
      definicoes: it.def ? [it.def] : (spec.ehEvento(it.tipo) ? ['none'] : []),
      bounds: null
    };
    var cat = spec.categoria(it.tipo);
    if (cat === 'evento') {
      falso.bounds = { x: 6, y: 6, width: 28, height: 28 };
    } else if (cat === 'gateway') {
      falso.bounds = { x: 5, y: 5, width: 30, height: 30 };
    } else if (it.tipo === 'participant' || it.tipo === 'lane' || it.tipo === 'group') {
      falso.bounds = { x: 3, y: 8, width: 34, height: 24 };
    } else if (cat === 'dado' || it.tipo === 'textAnnotation') {
      falso.bounds = { x: 10, y: 5, width: 20, height: 30 };
    } else {
      falso.bounds = { x: 3, y: 9, width: 34, height: 22 };
    }
    var rTemp = Object.create(SB.Renderer.prototype);
    rTemp.modelo = { elementos: {}, ordem: [], fluxos: {}, ordemFluxos: [] };
    rTemp.camadas = { nos: svg, rotulos: svg, overlay: svg };
    rTemp.mapaNos = {};
    rTemp._registrar = function () {};
    rTemp._rotuloExterno = function () {};
    try {
      var g = u.el('g', { class: 'bpmn-no cat-' + cat }, svg);
      if (cat === 'evento') rTemp._evento(g, falso);
      else if (cat === 'atividade') rTemp._atividade(g, falso);
      else if (cat === 'gateway') rTemp._gateway(g, falso);
      else if (cat === 'dado') rTemp._dado(g, falso);
      else if (it.tipo === 'textAnnotation') rTemp._anotacao(g, Object.assign({ texto: '' }, falso));
      else if (it.tipo === 'participant' || it.tipo === 'lane') {
        u.el('rect', { x: 3, y: 8, width: 34, height: 24, class: 'forma-piscina' }, g);
        u.el('line', { x1: 11, y1: 8, x2: 11, y2: 32, class: 'linha-piscina' }, g);
      } else if (it.tipo === 'group') {
        u.el('rect', { x: 3, y: 8, width: 34, height: 24, rx: 4, class: 'forma-grupo' }, g);
      }
    } catch (e) { /* icone e apenas decorativo */ }
    return svg;
  }

  /* ============================================================== UI */

  function ligarUI() {
    $('#lista-arquivos').addEventListener('change', function (e) { abrirDoServidor(e.target.value); });
    $('#btn-recarregar-lista').addEventListener('click', carregarListaArquivos);

    $('#input-arquivo').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { carregarXml(String(fr.result), f.name); };
      fr.readAsText(f, 'utf-8');
      e.target.value = '';
    });

    $('#btn-novo').addEventListener('click', function () {
      if (App.alterado && !confirm('Ha alteracoes nao salvas. Criar um novo diagrama mesmo assim?')) return;
      App.definirModelo(SB.Editor.modeloVazio(false), { nome: null });
      App.alterado = false;
      irParaAba('propriedades');
    });
    $('#btn-novo-piscinas').addEventListener('click', function () {
      if (App.alterado && !confirm('Ha alteracoes nao salvas. Criar um novo diagrama mesmo assim?')) return;
      App.definirModelo(SB.Editor.modeloVazio(true), { nome: null });
      App.alterado = false;
      irParaAba('propriedades');
    });

    $('#btn-salvar').addEventListener('click', salvarNoServidor);
    $('#btn-salvar-como').addEventListener('click', function () { App.nomeArquivo = null; salvarNoServidor(); });
    $('#btn-exportar-bpmn').addEventListener('click', function () {
      baixar(sugerirNome(), SB.serializer.gerar(App.modelo), 'application/xml');
    });
    $('#btn-exportar-svg').addEventListener('click', function () {
      baixar(sugerirNome().replace(/\.bpmn$/, '') + '.svg', svgAutonomo(), 'image/svg+xml');
    });
    $('#btn-exportar-png').addEventListener('click', exportarPng);

    $('#btn-ajustar').addEventListener('click', function () { App.r.ajustarNaTela(); App.editor.desenharAuxiliares(); });
    $('#btn-zoom-mais').addEventListener('click', function () { App.r.zoom(1.2); App.editor.desenharAuxiliares(); });
    $('#btn-zoom-menos').addEventListener('click', function () { App.r.zoom(1 / 1.2); App.editor.desenharAuxiliares(); });
    $('#btn-reorganizar').addEventListener('click', function () {
      App.editor.snapshot();
      SB.layout.reorganizar(App.modelo);
      App.marcarAlterado();
      App.redesenhar();
      App.r.ajustarNaTela();
      App.mostrarDica('Layout reorganizado (fluxo da esquerda para a direita).');
    });

    $('#btn-desfazer').addEventListener('click', function () { App.editor.desfazer(); });
    $('#btn-refazer').addEventListener('click', function () { App.editor.refazer(); });

    $('#btn-selecionar').addEventListener('click', function () {
      u.$$('.paleta-item').forEach(function (b) { b.classList.remove('ativo'); });
      App.editor.definirModo('selecionar');
    });
    $('#btn-conectar').addEventListener('click', function () {
      App.editor.definirModo('conectar-sequencia');
      App.mostrarDica('Clique na origem e depois no destino do fluxo de sequencia.');
    });
    $('#btn-conectar-msg').addEventListener('click', function () {
      App.editor.definirModo('conectar-mensagem');
      App.mostrarDica('Clique na origem e depois no destino do fluxo de mensagem (piscinas diferentes).');
    });
    $('#btn-excluir').addEventListener('click', function () { App.editor.excluirSelecao(); });
    // eventos de borda ficam no pad do elemento e no menu do botao direito
    $('#chk-fixar-paleta').addEventListener('change', function (e) { App.fixarPaleta = e.target.checked; });

    u.$$('#painel-abas button').forEach(function (b) {
      b.addEventListener('click', function () { irParaAba(b.getAttribute('data-aba')); });
    });

    // simulacao
    $('#btn-play').addEventListener('click', alternarPlay);
    $('#btn-passo').addEventListener('click', passoUnico);
    $('#btn-reset').addEventListener('click', reiniciarSim);
    $('#vel').addEventListener('input', function (e) {
      App.velocidade = Number(e.target.value);
      $('#vel-valor').textContent = App.velocidade + 'x';
    });
    ['#cfg-instancias', '#cfg-intervalo', '#cfg-durmin', '#cfg-durmax', '#cfg-transito', '#cfg-decisao', '#cfg-inicio', '#cfg-msg']
      .forEach(function (sel) {
        $(sel).addEventListener('change', function () {
          if (App.sim) Object.assign(App.sim.cfg, lerConfigSim());
        });
      });
    $('#chk-mapa-calor').addEventListener('change', function (e) {
      App.mapaCalor = e.target.checked;
      App.redesenhar();
    });
    $('#btn-limpar-log').addEventListener('click', function () {
      if (App.sim) App.sim.log.length = 0;
      $('#sim-log').innerHTML = '';
    });
    $('#btn-validar').addEventListener('click', function () { App.renderValidacao(true); });
    $('#btn-exportar-csv').addEventListener('click', exportarCsv);

    // busca na paleta
    var busca = $('#paleta-busca');
    busca.addEventListener('input', function () { filtrarPaleta(busca.value); });
    busca.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { busca.value = ''; filtrarPaleta(''); busca.blur(); }
      if (ev.key === 'Enter') {
        var primeiro = u.$$('.paleta-item:not(.oculto)')[0];
        if (primeiro) primeiro.click();
      }
    });
    $('#paleta-limpar').addEventListener('click', function () {
      busca.value = ''; filtrarPaleta(''); busca.focus();
    });

    // menu "Exportar"
    var menuExp = $('#menu-exportar');
    $('#btn-exportar').addEventListener('click', function (ev) {
      ev.stopPropagation();
      menuExp.classList.toggle('oculto');
    });
    u.$$('#menu-exportar button').forEach(function (b) {
      b.addEventListener('click', function () { menuExp.classList.add('oculto'); });
    });

    // fecha menus flutuantes ao clicar fora
    document.addEventListener('mousedown', function (ev) {
      if (!ev.target.closest || !ev.target.closest('#menu-contexto')) App.fecharMenuContexto();
      if (!ev.target.closest || (!ev.target.closest('#menu-exportar') && !ev.target.closest('#btn-exportar'))) {
        menuExp.classList.add('oculto');
      }
    });

    window.addEventListener('resize', function () { App.editor.desenharAuxiliares(); });
    window.addEventListener('beforeunload', function (e) {
      if (App.alterado) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  App.atualizarBarraModo = function () {
    var modo = App.editor.modo;
    u.$$('.btn-modo').forEach(function (b) { b.classList.remove('ativo'); });
    if (modo === 'selecionar') $('#btn-selecionar').classList.add('ativo');
    if (modo === 'conectar-sequencia') $('#btn-conectar').classList.add('ativo');
    if (modo === 'conectar-mensagem') $('#btn-conectar-msg').classList.add('ativo');
    if (modo !== 'criar') u.$$('.paleta-item').forEach(function (b) { b.classList.remove('ativo'); });
    App.atualizarDicaModo();
  };

  function irParaAba(nome) {
    App.aba = nome;
    u.$$('#painel-abas button').forEach(function (b) {
      b.classList.toggle('ativo', b.getAttribute('data-aba') === nome);
    });
    u.$$('.painel-aba').forEach(function (p) {
      p.classList.toggle('oculto', p.id !== 'aba-' + nome);
    });
    if (nome === 'estatisticas') App.renderEstatisticas();
    if (nome === 'validacao') App.renderValidacao();
  }

  /* ==================================================== menu de contexto */

  App.fecharMenuContexto = function () {
    var m = $('#menu-contexto');
    if (m) m.classList.add('oculto');
  };

  App.abrirMenuContexto = function (x, y, id, pontoDiagrama) {
    var menu = $('#menu-contexto');
    var ed = App.editor;
    var mod = App.modelo;
    menu.innerHTML = '';

    var itens = [];
    var fluxo = id ? mod.fluxos[id] : null;
    var el = id ? mod.elementos[id] : null;

    if (el) {
      itens.push({ rotulo: 'Renomear', atalho: 'F2', acao: function () { App.focarNomeNasPropriedades(id); } });
      if (spec.podeSerOrigemSequencia(el.tipo)) {
        itens.push({ rotulo: 'Ligar a outro elemento', acao: function () { ed._iniciarConexao(id, 'sequenceFlow'); } });
      }
      if (spec.podeSerOrigemMensagem(el.tipo, el.definicoes)) {
        itens.push({ rotulo: 'Enviar mensagem para outra piscina', acao: function () { ed._iniciarConexao(id, 'messageFlow'); } });
      }
      if (spec.ehAtividade(el.tipo)) {
        itens.push({ rotulo: 'Anexar borda de temporizador', acao: function () { ed.adicionarBorda(id, 'timer'); } });
        itens.push({ rotulo: 'Anexar borda de erro', acao: function () { ed.adicionarBorda(id, 'error'); } });
      }
      itens.push({ separador: true });
      itens.push({ rotulo: 'Duplicar', atalho: 'Ctrl+D', acao: function () { ed.duplicar(id); } });
      itens.push({ rotulo: 'Excluir', atalho: 'Delete', perigo: true, acao: function () { ed.excluirSelecao(); } });
    } else if (fluxo) {
      itens.push({ rotulo: 'Renomear fluxo', atalho: 'F2', acao: function () { App.focarNomeNasPropriedades(id); } });
      itens.push({ rotulo: 'Excluir fluxo', atalho: 'Delete', perigo: true, acao: function () { ed.excluirSelecao(); } });
    } else {
      itens.push({ rotulo: 'Inserir tarefa aqui', acao: function () { criarNoMenu('task', null, pontoDiagrama); } });
      itens.push({ rotulo: 'Inserir gateway exclusivo aqui', acao: function () { criarNoMenu('exclusiveGateway', null, pontoDiagrama); } });
      itens.push({ rotulo: 'Inserir evento de fim aqui', acao: function () { criarNoMenu('endEvent', 'none', pontoDiagrama); } });
      itens.push({ separador: true });
      itens.push({ rotulo: 'Reorganizar diagrama', acao: function () { $('#btn-reorganizar').click(); } });
      itens.push({ rotulo: 'Ajustar a tela', acao: function () { App.r.ajustarNaTela(); App.editor.desenharAuxiliares(); } });
    }

    itens.forEach(function (it) {
      if (it.separador) {
        menu.appendChild(u.h('div', { class: 'menu-separador' }));
        return;
      }
      var b = u.h('button', { class: 'menu-item' + (it.perigo ? ' perigo' : '') }, [
        u.h('span', { text: it.rotulo }),
        it.atalho ? u.h('kbd', { text: it.atalho }) : null
      ]);
      b.addEventListener('click', function () {
        App.fecharMenuContexto();
        it.acao();
      });
      menu.appendChild(b);
    });

    menu.classList.remove('oculto');
    // mantem o menu dentro da janela
    var r = menu.getBoundingClientRect();
    var px = Math.min(x, window.innerWidth - r.width - 8);
    var py = Math.min(y, window.innerHeight - r.height - 8);
    menu.style.left = Math.max(4, px) + 'px';
    menu.style.top = Math.max(4, py) + 'px';
  };

  function criarNoMenu(tipo, def, ponto) {
    App.editor.definirModo('criar', tipo, def);
    App.editor.criarNoPonto(ponto);
    App.editor.definirModo('selecionar');
  }

  /* ======================================================== onboarding */

  var CHAVE_BOAS_VINDAS = 'simuladorBpmn.boasVindasVista';

  App.abrirBoasVindas = function (forcado) {
    if (!forcado) {
      try { if (localStorage.getItem(CHAVE_BOAS_VINDAS) === '1') return; } catch (e) { /* ignora */ }
    }
    $('#boas-vindas').classList.remove('oculto');
  };

  function ligarBoasVindas() {
    $('#bv-fechar').addEventListener('click', function () {
      if ($('#bv-nao-mostrar').checked) {
        try { localStorage.setItem(CHAVE_BOAS_VINDAS, '1'); } catch (e) { /* ignora */ }
      }
      $('#boas-vindas').classList.add('oculto');
    });
    $('#bv-exemplo').addEventListener('click', function () {
      $('#boas-vindas').classList.add('oculto');
      try { localStorage.setItem(CHAVE_BOAS_VINDAS, '1'); } catch (e) { /* ignora */ }
      var sel = $('#lista-arquivos');
      var alvo = Array.prototype.map.call(sel.options, function (o) { return o.value; })
        .filter(function (v) { return v; })[0];
      if (alvo) { sel.value = alvo; abrirDoServidor(alvo); }
    });
    $('#btn-ajuda').addEventListener('click', function () { App.abrirBoasVindas(true); });
  }

  /* ================================================= dicas contextuais */

  var DICAS_MODO = {
    'selecionar': 'Clique para selecionar · arraste o fundo para mover a tela · duplo clique no vazio cria uma tarefa',
    'criar': 'Clique no diagrama para posicionar o elemento · Esc cancela',
    'conectar-sequencia': 'Clique na origem e depois no destino · Esc cancela',
    'conectar-mensagem': 'Ligue elementos de piscinas diferentes · Esc cancela'
  };

  App.atualizarDicaModo = function () {
    var barra = $('#dica-modo');
    if (!barra) return;
    if (!App.editor.habilitado) {
      barra.textContent = 'Simulacao em andamento — a edicao fica bloqueada. Use Reiniciar para voltar a editar.';
      barra.className = 'dica-modo simulando';
      return;
    }
    if (App.editor.conexao) {
      barra.textContent = 'Ligando a partir de "' + nomeDe(App.editor.conexao.origem) + '" — clique no destino (Esc cancela)';
      barra.className = 'dica-modo ligando';
      return;
    }
    barra.textContent = DICAS_MODO[App.editor.modo] || DICAS_MODO['selecionar'];
    barra.className = 'dica-modo';
  };

  /** Habilita/desabilita botoes que dependem da selecao. */
  App.atualizarAcoesDependentes = function () {
    var n = App.editor ? App.editor.selecao.length : 0;
    var umaAtividade = n === 1 && App.modelo &&
      App.modelo.elementos[App.editor.selecao[0]] &&
      spec.ehAtividade(App.modelo.elementos[App.editor.selecao[0]].tipo);
    var d = function (sel, ligado) { var b = $(sel); if (b) b.disabled = !ligado; };
    d('#btn-excluir', n > 0);
    d('#btn-borda-timer', umaAtividade);
    d('#btn-borda-erro', umaAtividade);
    App.atualizarDicaModo();
  };

  App.mostrarDica = function (texto, tipo) {
    var d = $('#dica');
    d.textContent = texto;
    d.className = 'dica visivel ' + (tipo || 'info');
    clearTimeout(App._dicaTimer);
    App._dicaTimer = setTimeout(function () { d.className = 'dica'; }, 4200);
  };

  function atualizarStatus() {
    var m = App.modelo;
    var partes = [];
    partes.push(App.nomeArquivo ? App.nomeArquivo : '(nao salvo)');
    if (App.alterado) partes.push('* alterado');
    if (m) {
      var nos = m.ordem.filter(function (id) {
        return ['evento', 'atividade', 'gateway'].indexOf(spec.categoria(m.elementos[id].tipo)) !== -1;
      }).length;
      partes.push(nos + ' elementos de fluxo');
      partes.push(m.ordemFluxos.length + ' conexoes');
      var piscinas = m.ordem.filter(function (id) { return m.elementos[id].tipo === 'participant'; }).length;
      if (piscinas) partes.push(piscinas + ' piscina(s)');
    }
    $('#status').textContent = partes.join('  |  ');
    $('#titulo-arquivo').textContent = App.nomeArquivo || 'Novo diagrama';
    App.atualizarBotoesHistorico();
  }

  /* ====================================================== propriedades */

  App.focarNomeNasPropriedades = function (id) {
    irParaAba('propriedades');
    App.editor.selecionar([id]);
    var campo = $('#prop-nome');
    if (campo) { campo.focus(); campo.select(); }
  };

  App.mostrarPropriedades = function (ids, origem) {
    var cont = $('#props-conteudo');
    cont.innerHTML = '';
    var m = App.modelo;
    // selecao feita no diagrama abre as propriedades sozinha
    if (origem === 'canvas' && ids && ids.length === 1 && App.aba !== 'propriedades') {
      irParaAba('propriedades');
    }
    if (!ids || ids.length === 0) {
      cont.appendChild(u.h('div', { class: 'estado-vazio' }, [
        u.h('strong', { text: 'Nenhum elemento selecionado' }),
        u.h('p', { text: 'Clique em qualquer elemento do diagrama para editar nome, tipo, duracao e custo.' }),
        u.h('p', { class: 'campo-ajuda', text: 'Para criar: arraste um item da paleta para o diagrama, ou clique no item e depois no diagrama. Duplo clique no espaco vazio insere uma tarefa.' })
      ]));
      cont.appendChild(blocoProcesso());
      return;
    }
    if (ids.length > 1) {
      cont.appendChild(u.h('p', { class: 'vazio', text: ids.length + ' elementos selecionados. Use Delete para excluir ou arraste para mover em bloco.' }));
      return;
    }
    var id = ids[0];
    var f = m.fluxos[id];
    if (f) return propriedadesFluxo(cont, f);
    var e = m.elementos[id];
    if (e) return propriedadesElemento(cont, e);
  };

  function campo(rotulo, input, ajuda) {
    return u.h('label', { class: 'campo' }, [
      u.h('span', { class: 'campo-rotulo', text: rotulo }),
      input,
      ajuda ? u.h('small', { class: 'campo-ajuda', text: ajuda }) : null
    ]);
  }

  function propriedadesElemento(cont, e) {
    var m = App.modelo;
    cont.appendChild(u.h('div', { class: 'prop-cabecalho' }, [
      u.h('strong', { text: spec.rotulo(e.tipo) }),
      u.h('code', { text: e.id })
    ]));

    var inpNome = u.h('input', { id: 'prop-nome', type: 'text', value: e.nome || '' });
    inpNome.addEventListener('input', function () {
      e.nome = inpNome.value;
      App.marcarAlterado();
      App.redesenhar();
    });
    inpNome.addEventListener('change', function () { App.editor.snapshot(); });
    cont.appendChild(campo('Nome', inpNome,
      spec.ehAtividade(e.tipo) ? 'Use "verbo + substantivo": Registrar pedido, Conferir estoque.' :
        (spec.ehGateway(e.tipo) ? 'Nomeie gateways divergentes como uma pergunta.' : '')));

    if (e.tipo === 'textAnnotation') {
      var ta = u.h('textarea', { rows: 3 });
      ta.value = e.texto || '';
      ta.addEventListener('input', function () { e.texto = ta.value; App.marcarAlterado(); App.redesenhar(); });
      cont.appendChild(campo('Texto da anotacao', ta));
    }

    // troca de tipo dentro da mesma categoria
    var cat = spec.categoria(e.tipo);
    var similares = Object.keys(spec.TIPOS).filter(function (t) { return spec.categoria(t) === cat; });
    if (similares.length > 1 && ['evento', 'atividade', 'gateway'].indexOf(cat) !== -1) {
      var selTipo = u.h('select', {});
      similares.forEach(function (t) {
        selTipo.appendChild(u.h('option', { value: t, text: spec.rotulo(t), selected: t === e.tipo ? 'selected' : null }));
      });
      selTipo.value = e.tipo;
      selTipo.addEventListener('change', function () {
        App.editor.snapshot();
        e.tipo = selTipo.value;
        var permitidas = spec.DEFINICOES_PERMITIDAS[e.tipo];
        if (permitidas && e.definicoes && permitidas.indexOf(e.definicoes[0]) === -1) {
          e.definicoes = [permitidas[0]];
        }
        var t = SB.layout.tamanhoPadrao(e.tipo);
        if (spec.categoria(e.tipo) !== 'atividade') { e.bounds.width = t.width; e.bounds.height = t.height; }
        App.marcarAlterado();
        App.redesenhar();
        App.mostrarPropriedades([e.id]);
      });
      cont.appendChild(campo('Tipo do elemento', selTipo));
    }

    if (spec.ehEvento(e.tipo)) {
      var permitidas = spec.DEFINICOES_PERMITIDAS[e.tipo] || ['none'];
      var selDef = u.h('select', {});
      permitidas.forEach(function (d) {
        selDef.appendChild(u.h('option', { value: d, text: (spec.DEFINICOES[d] || {}).rotulo || d }));
      });
      selDef.value = (e.definicoes && e.definicoes[0]) || permitidas[0];
      selDef.addEventListener('change', function () {
        App.editor.snapshot();
        e.definicoes = [selDef.value];
        App.marcarAlterado();
        App.redesenhar();
      });
      cont.appendChild(campo('Gatilho do evento', selDef, 'BPMN 10.5: apenas gatilhos validos para este tipo sao listados.'));

      if (e.tipo === 'boundaryEvent') {
        var chk = u.h('input', { type: 'checkbox' });
        chk.checked = e.cancelActivity !== false;
        chk.addEventListener('change', function () {
          App.editor.snapshot();
          e.cancelActivity = chk.checked;
          App.marcarAlterado(); App.redesenhar();
        });
        cont.appendChild(u.h('label', { class: 'campo-inline' }, [chk, u.h('span', { text: 'Interrompe a atividade (evento interrompente)' })]));
      }
    }

    if (spec.ehAtividade(e.tipo)) {
      var selLoop = u.h('select', {});
      [['', 'Nenhum'], ['standard', 'Loop padrao'], ['paralelo', 'Multi-instancia paralela'], ['sequencial', 'Multi-instancia sequencial']]
        .forEach(function (o) { selLoop.appendChild(u.h('option', { value: o[0], text: o[1] })); });
      selLoop.value = e.loop || '';
      selLoop.addEventListener('change', function () {
        App.editor.snapshot();
        e.loop = selLoop.value || null;
        App.marcarAlterado(); App.redesenhar();
      });
      cont.appendChild(campo('Repeticao', selLoop, 'BPMN 10.3.8 - marcadores de loop e multi-instancia.'));
    }

    if (spec.ehGateway(e.tipo) && (e.saidas || []).length > 1 &&
        ['exclusiveGateway', 'inclusiveGateway', 'complexGateway'].indexOf(e.tipo) !== -1) {
      var selPad = u.h('select', {});
      selPad.appendChild(u.h('option', { value: '', text: '(sem fluxo padrao)' }));
      (e.saidas || []).forEach(function (fid) {
        var fl = m.fluxos[fid];
        selPad.appendChild(u.h('option', { value: fid, text: fl.nome || ('-> ' + nomeDe(fl.alvo)) }));
      });
      selPad.value = e.padrao || '';
      selPad.addEventListener('change', function () {
        App.editor.snapshot();
        e.padrao = selPad.value || null;
        App.marcarAlterado(); App.redesenhar();
      });
      cont.appendChild(campo('Fluxo padrao', selPad, 'Caminho usado quando nenhuma condicao e verdadeira (BPMN 10.6.2).'));
    }

    // parametros de simulacao
    if (['atividade', 'evento'].indexOf(cat) !== -1) {
      cont.appendChild(u.h('h4', { class: 'prop-secao', text: 'Parametros de simulacao' }));
      cont.appendChild(campoNumero('Duracao minima (s)', e, 'duracaoMin'));
      cont.appendChild(campoNumero('Duracao maxima (s)', e, 'duracaoMax'));
      cont.appendChild(campoNumero('Custo por execucao', e, 'custo'));
      var inpRec = u.h('input', { type: 'text', value: (e.sim && e.sim.recurso) || '' });
      inpRec.addEventListener('change', function () {
        App.editor.snapshot();
        e.sim = e.sim || {};
        e.sim.recurso = inpRec.value;
        App.marcarAlterado();
      });
      cont.appendChild(campo('Recurso / papel', inpRec));
    }

    cont.appendChild(u.h('h4', { class: 'prop-secao', text: 'Documentacao' }));
    var doc = u.h('textarea', { rows: 3 });
    doc.value = e.documentacao || '';
    doc.addEventListener('change', function () {
      App.editor.snapshot();
      e.documentacao = doc.value;
      App.marcarAlterado();
    });
    cont.appendChild(doc);

    cont.appendChild(u.h('div', { class: 'prop-conexoes' }, [
      u.h('div', { text: 'Entradas: ' + (e.entradas || []).length + '   |   Saidas: ' + (e.saidas || []).length }),
      e.laneId ? u.h('div', { text: 'Raia: ' + nomeDe(e.laneId) }) : null,
      e.participantId ? u.h('div', { text: 'Piscina: ' + nomeDe(e.participantId) }) : null
    ]));
  }

  function campoNumero(rotulo, alvo, chave) {
    var inp = u.h('input', { type: 'number', min: '0', step: '1' });
    inp.value = (alvo.sim && alvo.sim[chave] !== undefined && !isNaN(alvo.sim[chave])) ? alvo.sim[chave] : '';
    inp.addEventListener('change', function () {
      App.editor.snapshot();
      alvo.sim = alvo.sim || {};
      if (inp.value === '') delete alvo.sim[chave];
      else alvo.sim[chave] = Number(inp.value);
      App.marcarAlterado();
    });
    return campo(rotulo, inp);
  }

  function propriedadesFluxo(cont, f) {
    var m = App.modelo;
    cont.appendChild(u.h('div', { class: 'prop-cabecalho' }, [
      u.h('strong', { text: f.tipo === 'messageFlow' ? 'Fluxo de mensagem' : (f.tipo === 'association' ? 'Associacao' : 'Fluxo de sequencia') }),
      u.h('code', { text: f.id })
    ]));
    cont.appendChild(u.h('p', { class: 'prop-rota', text: nomeDe(f.origem) + '  ->  ' + nomeDe(f.alvo) }));

    var inpNome = u.h('input', { id: 'prop-nome', type: 'text', value: f.nome || '' });
    inpNome.addEventListener('input', function () { f.nome = inpNome.value; App.marcarAlterado(); App.redesenhar(); });
    inpNome.addEventListener('change', function () { App.editor.snapshot(); });
    cont.appendChild(campo('Rotulo', inpNome, f.tipo === 'messageFlow' ? 'Nomeie a mensagem trocada.' : 'Em gateways, nomeie com a resposta (Sim / Nao).'));

    if (f.tipo === 'sequenceFlow') {
      var inpCond = u.h('input', { type: 'text', value: f.condicao || '' });
      inpCond.addEventListener('change', function () {
        App.editor.snapshot();
        f.condicao = inpCond.value;
        App.marcarAlterado(); App.redesenhar();
      });
      cont.appendChild(campo('Condicao', inpCond, 'Expressao textual, ex.: valor > 1000 (BPMN 10.6.1).'));

      var inpProb = u.h('input', { type: 'number', min: '0', max: '100', step: '1' });
      inpProb.value = (f.sim && f.sim.probabilidade !== undefined && !isNaN(f.sim.probabilidade)) ? f.sim.probabilidade : '';
      inpProb.addEventListener('change', function () {
        App.editor.snapshot();
        f.sim = f.sim || {};
        if (inpProb.value === '') delete f.sim.probabilidade;
        else f.sim.probabilidade = Number(inpProb.value);
        App.marcarAlterado();
      });
      cont.appendChild(campo('Probabilidade na simulacao (%)', inpProb,
        'Usada quando o gateway decide automaticamente. Vazio = distribuicao uniforme.'));

      var origem = m.elementos[f.origem];
      if (origem && ['exclusiveGateway', 'inclusiveGateway', 'complexGateway'].indexOf(origem.tipo) !== -1) {
        var chk = u.h('input', { type: 'checkbox' });
        chk.checked = origem.padrao === f.id;
        chk.addEventListener('change', function () {
          App.editor.snapshot();
          origem.padrao = chk.checked ? f.id : null;
          App.marcarAlterado(); App.redesenhar();
        });
        cont.appendChild(u.h('label', { class: 'campo-inline' }, [chk, u.h('span', { text: 'Este e o fluxo padrao do gateway' })]));
      }
    }

    var btn = u.h('button', { class: 'btn perigo', text: 'Excluir este fluxo' });
    btn.addEventListener('click', function () { App.editor.excluirSelecao(); });
    cont.appendChild(btn);
  }

  function blocoProcesso() {
    var m = App.modelo;
    var div = u.h('div', { class: 'bloco-processo' });
    div.appendChild(u.h('h4', { class: 'prop-secao', text: 'Diagrama' }));
    var inp = u.h('input', { type: 'text', value: m && m.nome ? m.nome : '' });
    inp.addEventListener('change', function () {
      m.nome = inp.value;
      var pid = m.ordemProcessos[0];
      if (pid) m.processos[pid].nome = inp.value;
      App.marcarAlterado();
      atualizarStatus();
    });
    div.appendChild(campo('Nome do processo', inp));
    div.appendChild(u.h('p', { class: 'campo-ajuda', text: 'Processos: ' + (m ? m.ordemProcessos.length : 0) + '   |   Colaboracao: ' + (m && m.colaboracao ? 'sim' : 'nao') }));
    return div;
  }

  function nomeDe(id) {
    var m = App.modelo;
    var e = m.elementos[id];
    if (!e) return id;
    return e.nome || spec.rotulo(e.tipo);
  }

  /* ========================================================== validacao */

  App.renderValidacao = function (avisar) {
    var cont = $('#validacao-conteudo');
    if (!App.modelo) return;
    var achados = SB.validador.validar(App.modelo);
    var contagem = { erro: 0, aviso: 0, dica: 0 };
    achados.forEach(function (a) { contagem[a.severidade]++; });

    $('#badge-validacao').textContent = contagem.erro ? contagem.erro : (contagem.aviso ? contagem.aviso : '');
    $('#badge-validacao').className = 'badge ' + (contagem.erro ? 'erro' : (contagem.aviso ? 'aviso' : 'oculto'));

    cont.innerHTML = '';
    cont.appendChild(u.h('div', { class: 'resumo-validacao' }, [
      u.h('span', { class: 'pill erro', text: contagem.erro + ' erro(s)' }),
      u.h('span', { class: 'pill aviso', text: contagem.aviso + ' aviso(s)' }),
      u.h('span', { class: 'pill dica', text: contagem.dica + ' dica(s)' })
    ]));

    if (!achados.length) {
      cont.appendChild(u.h('p', { class: 'ok', text: 'Nenhum problema encontrado. O diagrama respeita as regras de conexao e de eventos do BPMN 2.0.2.' }));
      if (avisar) App.mostrarDica('Diagrama valido.');
      return;
    }
    var lista = u.h('ul', { class: 'lista-validacao' });
    achados.forEach(function (a) {
      var li = u.h('li', { class: 'item-val ' + a.severidade }, [
        u.h('span', { class: 'sev', text: a.severidade === 'erro' ? 'ERRO' : (a.severidade === 'aviso' ? 'AVISO' : 'DICA') }),
        u.h('span', { class: 'msg', text: a.mensagem }),
        a.referencia ? u.h('span', { class: 'ref', text: a.referencia }) : null
      ]);
      if (a.elementoId) {
        li.classList.add('clicavel');
        li.addEventListener('click', function () {
          App.editor.selecionar([a.elementoId]);
          centralizarEm(a.elementoId);
        });
      }
      lista.appendChild(li);
    });
    cont.appendChild(lista);
    if (avisar) App.mostrarDica(contagem.erro + ' erro(s) e ' + contagem.aviso + ' aviso(s) encontrados.', contagem.erro ? 'erro' : 'aviso');
  };

  function centralizarEm(id) {
    var e = App.modelo.elementos[id];
    if (!e || !e.bounds) return;
    var r = App.r.svg.getBoundingClientRect();
    var c = u.centro(e.bounds);
    App.r.tx = r.width / 2 - c.x * App.r.escala;
    App.r.ty = r.height / 2 - c.y * App.r.escala;
    App.r.aplicarTransform();
    App.editor.desenharAuxiliares();
  }

  /* ========================================================== simulacao */

  function lerConfigSim() {
    return {
      instancias: Math.max(1, Number($('#cfg-instancias').value) || 1),
      intervaloChegada: Math.max(1, Number($('#cfg-intervalo').value) || 60),
      duracaoMin: Math.max(1, Number($('#cfg-durmin').value) || 30),
      duracaoMax: Math.max(1, Number($('#cfg-durmax').value) || 120),
      tempoTransito: Math.max(0.2, Number($('#cfg-transito').value) || 3),
      atrasoMensagemExterna: Math.max(1, Number($('#cfg-msg').value) || 20),
      modoDecisao: $('#cfg-decisao').value,
      eventoInicial: $('#cfg-inicio').value || null
    };
  }

  function preencherEventosIniciais() {
    var sel = $('#cfg-inicio');
    sel.innerHTML = '';
    if (!App.sim) return;
    var inicios = App.sim.eventosDeInicio();
    if (!inicios.length) {
      sel.appendChild(u.h('option', { value: '', text: '(nenhum evento de inicio)' }));
      return;
    }
    inicios.forEach(function (e) {
      var pisc = e.participantId ? ' [' + nomeDe(e.participantId) + ']' : '';
      sel.appendChild(u.h('option', { value: e.id, text: (e.nome || e.id) + pisc }));
    });
    App.sim.cfg.eventoInicial = sel.value;
  }

  function ligarSimulador() {
    App.sim.aoLogar = function (entrada) { adicionarLog(entrada); };
    App.sim.aoPerguntar = function (gw, opcoes, escolher, op) { abrirModalDecisao(gw, opcoes, escolher, op); };
    App.sim.aoFinalizar = function () {
      atualizarBotaoPlay();
      App.renderEstatisticas();
      App.mostrarDica('Simulacao concluida. Veja a aba Estatisticas.');
    };
    $('#sim-log').innerHTML = '';
    atualizarContadores();
  }

  function alternarPlay() {
    if (!App.sim) return;
    if (App.sim.rodando) {
      App.sim.pausar();
    } else {
      if (App.sim.encerrado) reiniciarSim();
      App.editor.habilitado = false;
      App.editor.selecionar([]);
      var ok = App.sim.iniciar();
      if (!ok) { App.editor.habilitado = true; App.mostrarDica('Adicione um evento de inicio para simular.', 'erro'); }
      App.atualizarAcoesDependentes();
      irParaAba('simulacao');
    }
    atualizarBotaoPlay();
  }

  function passoUnico() {
    if (!App.sim) return;
    if (!App.sim.instancias.length) App.sim.iniciar();
    App.sim.rodando = true;
    App.sim.avancar(1);
    App.sim.rodando = false;
    atualizarBotaoPlay();
    desenharTokens();
    atualizarContadores();
  }

  function reiniciarSim() {
    if (!App.sim) return;
    App.sim.reiniciar();
    App.editor.habilitado = true;
    App.atualizarAcoesDependentes();
    $('#sim-log').innerHTML = '';
    App.r.limparEstados();
    App.redesenhar();
    atualizarContadores();
    atualizarBotaoPlay();
    App.renderEstatisticas();
  }

  function atualizarBotaoPlay() {
    var b = $('#btn-play');
    var rodando = App.sim && App.sim.rodando;
    b.textContent = rodando ? 'Pausar' : 'Iniciar';
    b.classList.toggle('rodando', !!rodando);
    $('#indicador-sim').textContent = rodando ? 'executando' : (App.sim && App.sim.encerrado ? 'concluida' : 'parada');
    $('#indicador-sim').className = 'indicador ' + (rodando ? 'on' : 'off');
  }

  function laco() {
    requestAnimationFrame(function passo(ts) {
      var dtReal = App.ultimoFrame ? Math.min(0.1, (ts - App.ultimoFrame) / 1000) : 0;
      App.ultimoFrame = ts;
      if (App.sim && App.sim.rodando && !App.sim.pausadoPorPergunta) {
        App.sim.avancar(dtReal * App.velocidade);
        desenharTokens();
        atualizarContadores();
      }
      requestAnimationFrame(passo);
    });
  }

  function desenharTokens() {
    var camada = App.r.camadas.overlay;
    u.$$('.token-grupo', camada).forEach(function (n) { n.remove(); });
    if (!App.sim) return;
    var g = u.el('g', { class: 'token-grupo' }, camada);
    var m = App.modelo;

    // limpa estados anteriores
    u.$$('.estado-ativo', App.r.svg).forEach(function (n) { n.classList.remove('estado-ativo'); });
    u.$$('.estado-espera', App.r.svg).forEach(function (n) { n.classList.remove('estado-espera'); });

    var porNo = {};
    App.sim.tokens.forEach(function (tk) {
      if (tk.estado === 'transito' && tk.fluxoId) {
        var f = m.fluxos[tk.fluxoId];
        var pts = App.r.pontosDoFluxo(f);
        if (!pts) return;
        var p = u.pontoNoCaminho(pts, tk.progresso);
        desenharToken(g, p.x, p.y, tk.cor);
        var gf = App.r.mapaFluxos[tk.fluxoId];
        if (gf) gf.classList.add('estado-ativo');
      } else if (tk.noId) {
        (porNo[tk.noId] || (porNo[tk.noId] = [])).push(tk);
      }
    });

    Object.keys(porNo).forEach(function (id) {
      var el = m.elementos[id];
      if (!el || !el.bounds) return;
      var lista = porNo[id];
      var gn = App.r.mapaNos[id];
      var esperando = lista.every(function (t) { return t.estado.indexOf('espera') === 0; });
      if (gn) gn.classList.add(esperando ? 'estado-espera' : 'estado-ativo');
      var bx = el.bounds.x + el.bounds.width - 6;
      var by = el.bounds.y - 4;
      lista.slice(0, 4).forEach(function (tk, i) {
        desenharToken(g, bx - i * 11, by, tk.cor);
      });
      if (lista.length > 4) {
        var t = u.el('text', { x: bx - 4 * 11 - 6, y: by + 4, class: 'token-contador' }, g);
        t.textContent = '+' + (lista.length - 4);
      }
      // barra de progresso da atividade
      var tk0 = lista[0];
      if (tk0.estado === 'trabalho' && tk0.duracaoTrabalho > 0 && spec.ehAtividade(el.tipo)) {
        var frac = Math.max(0, Math.min(1, 1 - tk0.restante / tk0.duracaoTrabalho));
        u.el('rect', {
          x: el.bounds.x + 6, y: el.bounds.y + el.bounds.height - 6,
          width: (el.bounds.width - 12) * frac, height: 3, rx: 1.5, class: 'barra-progresso'
        }, g);
      }
    });
  }

  function desenharToken(g, x, y, cor) {
    u.el('circle', { cx: x, cy: y, r: 7, class: 'token-sombra' }, g);
    u.el('circle', { cx: x, cy: y, r: 6, class: 'token', fill: cor || '#2563eb' }, g);
  }

  function atualizarContadores() {
    if (!App.sim) return;
    var s = App.sim;
    $('#c-tempo').textContent = u.formatarDuracao(s.tempo);
    $('#c-instancias').textContent = s.instancias.filter(function (i) { return !i.ativa; }).length + ' / ' + s.instancias.length;
    $('#c-tokens').textContent = s.tokens.length;
    var concl = s.instancias.filter(function (i) { return !i.ativa; });
    var media = concl.length ? concl.reduce(function (a, i) { return a + (i.fim - i.inicio); }, 0) / concl.length : 0;
    $('#c-ciclo').textContent = concl.length ? u.formatarDuracao(media) : '-';
  }

  var CLASSE_LOG = {
    atividade: 'log-atividade', gateway: 'log-gateway', mensagem: 'log-mensagem',
    instancia: 'log-instancia', fim: 'log-fim', erro: 'log-erro', aviso: 'log-aviso',
    espera: 'log-espera', juncao: 'log-juncao', borda: 'log-borda'
  };

  function adicionarLog(e) {
    var box = $('#sim-log');
    var linha = u.h('div', { class: 'linha-log ' + (CLASSE_LOG[e.tipo] || '') }, [
      u.h('span', { class: 'log-t', text: u.formatarDuracao(e.t) }),
      u.h('span', { class: 'log-msg', text: e.texto })
    ]);
    if (e.elementoId) {
      linha.classList.add('clicavel');
      linha.addEventListener('click', function () {
        App.editor.selecionar([e.elementoId]);
        centralizarEm(e.elementoId);
      });
    }
    box.appendChild(linha);
    while (box.childNodes.length > 400) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  function abrirModalDecisao(gw, opcoes, escolher, op) {
    var modal = $('#modal-decisao');
    var corpo = $('#modal-corpo');
    var multiplo = !!(op && op.multiplo);
    $('#modal-titulo').textContent = gw.nome || 'Decisao no gateway';
    corpo.innerHTML = '';
    corpo.appendChild(u.h('p', {
      class: 'modal-sub',
      text: multiplo
        ? 'Gateway inclusivo (' + spec.rotulo(gw.tipo) + '): marque todos os caminhos que devem ser ativados.'
        : 'Escolha o caminho a seguir (' + spec.rotulo(gw.tipo) + ').'
    }));

    if (!multiplo) {
      opcoes.forEach(function (o) {
        var b = u.h('button', { class: 'btn opcao', text: o.rotulo + (o.padrao ? '  (padrao)' : '') });
        b.addEventListener('click', function () {
          modal.classList.add('oculto');
          escolher(o.id);
        });
        corpo.appendChild(b);
      });
    } else {
      var caixas = opcoes.map(function (o) {
        var chk = u.h('input', { type: 'checkbox', value: o.id });
        corpo.appendChild(u.h('label', { class: 'campo-inline opcao-multipla' }, [
          chk, u.h('span', { text: o.rotulo + (o.padrao ? '  (padrao)' : '') })
        ]));
        return chk;
      });
      var confirmar = u.h('button', { class: 'btn primario opcao', text: 'Confirmar caminhos' });
      confirmar.addEventListener('click', function () {
        var ids = caixas.filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
        if (!ids.length) {
          App.mostrarDica('Selecione ao menos um caminho: um gateway inclusivo deve ativar pelo menos uma saida (BPMN 10.6.3).', 'aviso');
          return;
        }
        modal.classList.add('oculto');
        escolher(ids);
      });
      corpo.appendChild(confirmar);
    }
    modal.classList.remove('oculto');
  }

  /* ====================================================== estatisticas */

  App.renderEstatisticas = function () {
    var cont = $('#estat-conteudo');
    cont.innerHTML = '';
    if (!App.sim) return;
    var r = App.sim.resumo();

    var cartoes = u.h('div', { class: 'cartoes' });
    [
      ['Tempo simulado', u.formatarDuracao(r.tempo)],
      ['Instancias concluidas', r.concluidas + ' / ' + r.criadas],
      ['Tempo de ciclo medio', r.concluidas ? u.formatarDuracao(r.cicloMedio) : '-'],
      ['Ciclo min / max', r.concluidas ? (u.formatarDuracao(r.cicloMin) + ' / ' + u.formatarDuracao(r.cicloMax)) : '-'],
      ['Tempo em atividades', u.formatarDuracao(r.trabalho)],
      ['Tempo em espera', u.formatarDuracao(r.espera)],
      ['Eficiencia do ciclo', r.trabalho + r.espera > 0 ? u.formatarNumero(100 * r.trabalho / (r.trabalho + r.espera), 1) + '%' : '-'],
      ['Custo acumulado', r.custoTotal ? u.formatarNumero(r.custoTotal, 2) : '-']
    ].forEach(function (c) {
      cartoes.appendChild(u.h('div', { class: 'cartao' }, [
        u.h('span', { class: 'cartao-rotulo', text: c[0] }),
        u.h('strong', { class: 'cartao-valor', text: String(c[1]) })
      ]));
    });
    cont.appendChild(cartoes);

    if (!r.porElemento.length) {
      cont.appendChild(u.h('p', { class: 'vazio', text: 'Rode a simulacao para gerar indicadores por atividade.' }));
      return;
    }

    cont.appendChild(u.h('h4', { class: 'prop-secao', text: 'Por elemento (ordenado por tempo total)' }));
    var tabela = u.h('table', { class: 'tabela' });
    tabela.appendChild(u.h('thead', {}, [u.h('tr', {}, [
      u.h('th', { text: 'Elemento' }), u.h('th', { text: 'Tipo' }),
      u.h('th', { text: 'Exec.' }), u.h('th', { text: 'Tempo total' }),
      u.h('th', { text: 'Medio' }), u.h('th', { text: 'Espera' })
    ])]));
    var tb = u.h('tbody', {});
    var maxT = r.porElemento[0].tempoTotal || 1;
    r.porElemento.forEach(function (e) {
      var tr = u.h('tr', { class: 'clicavel' }, [
        u.h('td', {}, [
          u.h('span', { text: e.nome }),
          u.h('span', { class: 'barra-mini', style: 'width:' + Math.round(60 * e.tempoTotal / maxT) + 'px' })
        ]),
        u.h('td', { class: 'menor', text: spec.rotulo(e.tipo) }),
        u.h('td', { text: String(e.execucoes) }),
        u.h('td', { text: u.formatarDuracao(e.tempoTotal) }),
        u.h('td', { text: u.formatarDuracao(e.tempoMedio) }),
        u.h('td', { text: e.tempoEspera > 0.5 ? u.formatarDuracao(e.tempoEspera) : '-' })
      ]);
      tr.addEventListener('click', function () { App.editor.selecionar([e.id]); centralizarEm(e.id); });
      tb.appendChild(tr);
    });
    tabela.appendChild(tb);
    cont.appendChild(tabela);

    var gargalos = r.porElemento.filter(function (e) { return e.categoria === 'atividade'; }).slice(0, 3);
    if (gargalos.length) {
      cont.appendChild(u.h('div', { class: 'destaque' }, [
        u.h('strong', { text: 'Gargalos (maior tempo acumulado): ' }),
        u.h('span', { text: gargalos.map(function (g) { return g.nome; }).join('  |  ') })
      ]));
    }
  };

  function exportarCsv() {
    if (!App.sim) return;
    var r = App.sim.resumo();
    var linhas = ['elemento;tipo;execucoes;tempo_total_s;tempo_medio_s;tempo_espera_s;custo'];
    r.porElemento.forEach(function (e) {
      linhas.push([
        '"' + String(e.nome).replace(/"/g, "'") + '"', e.tipo, e.execucoes,
        Math.round(e.tempoTotal), Math.round(e.tempoMedio), Math.round(e.tempoEspera),
        e.custo ? e.custo.toFixed(2) : '0'
      ].join(';'));
    });
    linhas.push('');
    linhas.push('instancias_criadas;' + r.criadas);
    linhas.push('instancias_concluidas;' + r.concluidas);
    linhas.push('ciclo_medio_s;' + Math.round(r.cicloMedio));
    baixar(sugerirNome().replace(/\.bpmn$/, '') + '-simulacao.csv', linhas.join('\n'), 'text/csv');
  }

  /**
   * Mapa de calor: quanto mais o elemento executa, mais proximo do vermelho
   * Insper (matiz 0). Os limites de luminosidade vem dos tokens do tema,
   * para funcionar tanto no claro quanto no escuro.
   */
  function aplicarMapaCalor() {
    if (!App.sim) return;
    var stats = App.sim.stats;
    var max = 0;
    Object.keys(stats).forEach(function (id) { max = Math.max(max, stats[id].execucoes); });
    if (!max) return;
    var cs = getComputedStyle(document.documentElement);
    var l0 = parseFloat(cs.getPropertyValue('--dg-calor-l0')) || 96;
    var l1 = parseFloat(cs.getPropertyValue('--dg-calor-l1')) || 58;
    Object.keys(stats).forEach(function (id) {
      var g = App.r.mapaNos[id];
      if (!g) return;
      var frac = stats[id].execucoes / max;
      var forma = g.querySelector('.forma-atividade, .forma-gateway, .forma-evento');
      if (!forma) return;
      var sat = Math.round(10 + 85 * frac);
      var luz = Math.round(l0 + (l1 - l0) * frac);
      forma.style.fill = 'hsl(0, ' + sat + '%, ' + luz + '%)';
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})(window);
