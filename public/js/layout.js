/*
 * Layout automatico: gera geometria (BPMNShape/BPMNEdge) quando o arquivo
 * .bpmn nao traz DI, e permite reorganizar o diagrama pelo menu.
 * Estrategia: ranqueamento por caminho mais longo (esquerda -> direita),
 * respeitando raias (uma faixa horizontal por raia), como recomenda a
 * clausula 7.5 do BPMN 2.0.2 (fluxo da esquerda para a direita).
 */
(function (global) {
  'use strict';
  var SB = global.SB || (global.SB = {});
  var spec = SB.spec;

  var MARGEM_X = 60;
  var MARGEM_Y = 50;
  var ESPACO_COLUNA = 60;
  var ESPACO_LINHA = 40;
  var CABECALHO_PISCINA = 30;

  function tamanhoPadrao(tipo) {
    var t = spec.TIPOS[tipo];
    return t ? { width: t.w, height: t.h } : { width: 100, height: 80 };
  }

  function nosDoProcesso(m, processoId) {
    return m.ordem
      .map(function (id) { return m.elementos[id]; })
      .filter(function (e) {
        return e.pai === processoId && spec.TIPOS[e.tipo] &&
          ['evento', 'atividade', 'gateway'].indexOf(spec.categoria(e.tipo)) !== -1 &&
          e.tipo !== 'boundaryEvent';
      });
  }

  /** Ranqueia os nos: rank(n) = 1 + max(rank(predecessores)), ignorando ciclos. */
  function ranquear(m, nos) {
    var idx = {};
    nos.forEach(function (n, i) { idx[n.id] = i; });
    var rank = {};
    nos.forEach(function (n) { rank[n.id] = 0; });

    var arestas = [];
    m.ordemFluxos.forEach(function (fid) {
      var f = m.fluxos[fid];
      if (f.tipo !== 'sequenceFlow') return;
      if (idx[f.origem] === undefined || idx[f.alvo] === undefined) return;
      arestas.push([f.origem, f.alvo]);
    });

    // relaxamento iterativo limitado (evita loop infinito em ciclos)
    for (var it = 0; it < nos.length + 2; it++) {
      var mudou = false;
      for (var i = 0; i < arestas.length; i++) {
        var a = arestas[i][0], b = arestas[i][1];
        if (rank[b] < rank[a] + 1 && rank[a] + 1 <= nos.length) {
          rank[b] = rank[a] + 1;
          mudou = true;
        }
      }
      if (!mudou) break;
    }
    return rank;
  }

  function raiasDoProcesso(m, processoId) {
    return m.ordem
      .map(function (id) { return m.elementos[id]; })
      .filter(function (e) { return e.tipo === 'lane' && e.pai === processoId; });
  }

  /** Layout completo de um processo. Retorna a altura ocupada. */
  function layoutProcesso(m, processoId, offsetX, offsetY, larguraMin) {
    var nos = nosDoProcesso(m, processoId);
    if (!nos.length) return { largura: larguraMin || 600, altura: 160 };

    var rank = ranquear(m, nos);
    var raias = raiasDoProcesso(m, processoId);
    var mapaRaia = {};
    raias.forEach(function (r, i) { mapaRaia[r.id] = i; });

    // agrupa por (raia, rank)
    var colunas = {};
    var maxRank = 0;
    nos.forEach(function (n) {
      var r = rank[n.id] || 0;
      maxRank = Math.max(maxRank, r);
      var faixa = raias.length ? (mapaRaia[n.laneId] !== undefined ? mapaRaia[n.laneId] : 0) : 0;
      var chave = faixa + ':' + r;
      (colunas[chave] || (colunas[chave] = [])).push(n);
    });

    // largura de cada coluna
    var largCol = [];
    for (var r0 = 0; r0 <= maxRank; r0++) {
      var w = 0;
      for (var fa = 0; fa < Math.max(1, raias.length); fa++) {
        (colunas[fa + ':' + r0] || []).forEach(function (n) {
          w = Math.max(w, (n.bounds ? n.bounds.width : tamanhoPadrao(n.tipo).width));
        });
      }
      largCol.push(w || 120);
    }
    var xDeRank = [];
    var acc = offsetX + MARGEM_X;
    for (var r1 = 0; r1 <= maxRank; r1++) {
      xDeRank.push(acc);
      acc += largCol[r1] + ESPACO_COLUNA;
    }
    var larguraTotal = Math.max(larguraMin || 0, acc - offsetX + MARGEM_X);

    // altura de cada faixa
    var nFaixas = Math.max(1, raias.length);
    var alturaFaixa = [];
    for (var fb = 0; fb < nFaixas; fb++) {
      var maxAltura = 0;
      for (var r2 = 0; r2 <= maxRank; r2++) {
        var grupo = colunas[fb + ':' + r2] || [];
        var alt = 0;
        grupo.forEach(function (n) {
          alt += (n.bounds ? n.bounds.height : tamanhoPadrao(n.tipo).height) + ESPACO_LINHA;
        });
        maxAltura = Math.max(maxAltura, alt);
      }
      alturaFaixa.push(Math.max(120, maxAltura + MARGEM_Y));
    }

    // posiciona
    var yFaixa = offsetY;
    for (var fc = 0; fc < nFaixas; fc++) {
      if (raias.length) {
        raias[fc].bounds = {
          x: offsetX + CABECALHO_PISCINA,
          y: yFaixa,
          width: larguraTotal - CABECALHO_PISCINA,
          height: alturaFaixa[fc]
        };
        raias[fc].isHorizontal = true;
      }
      for (var r3 = 0; r3 <= maxRank; r3++) {
        var g = colunas[fc + ':' + r3] || [];
        var alturaGrupo = 0;
        g.forEach(function (n) { alturaGrupo += tamanhoDe(n).height + ESPACO_LINHA; });
        alturaGrupo -= ESPACO_LINHA;
        var y = yFaixa + (alturaFaixa[fc] - alturaGrupo) / 2;
        g.forEach(function (n) {
          var t = tamanhoDe(n);
          n.bounds = {
            x: Math.round(xDeRank[r3] + (largCol[r3] - t.width) / 2),
            y: Math.round(y),
            width: t.width,
            height: t.height
          };
          y += t.height + ESPACO_LINHA;
        });
      }
      yFaixa += alturaFaixa[fc];
    }

    var alturaTotal = yFaixa - offsetY;
    if (!raias.length) alturaTotal = Math.max(alturaTotal, 160);
    return { largura: larguraTotal, altura: alturaTotal };
  }

  function tamanhoDe(n) {
    if (n.bounds && n.bounds.width && n.bounds.height &&
        spec.categoria(n.tipo) !== 'container') {
      return { width: n.bounds.width, height: n.bounds.height };
    }
    return tamanhoPadrao(n.tipo);
  }

  /** Posiciona eventos de borda sobre a atividade a que estao anexados. */
  function posicionarBordas(m) {
    m.ordem.forEach(function (id) {
      var e = m.elementos[id];
      if (e.tipo !== 'boundaryEvent') return;
      var host = m.elementos[e.attachedToRef];
      if (!host || !host.bounds) return;
      if (e.bounds) return;
      var irmaos = (host.bordas || []).filter(function (b) { return b !== id; }).length;
      var t = tamanhoPadrao('boundaryEvent');
      e.bounds = {
        x: Math.round(host.bounds.x + host.bounds.width * 0.35 + irmaos * 45 - t.width / 2),
        y: Math.round(host.bounds.y + host.bounds.height - t.height / 2),
        width: t.width,
        height: t.height
      };
    });
  }

  /** Elemento de fluxo ligado a um artefato por associacao. */
  function parceiroAssociado(m, id) {
    for (var i = 0; i < m.ordemFluxos.length; i++) {
      var f = m.fluxos[m.ordemFluxos[i]];
      if (f.tipo !== 'association') continue;
      var outro = f.origem === id ? f.alvo : (f.alvo === id ? f.origem : null);
      if (!outro) continue;
      var e = m.elementos[outro];
      if (e && e.bounds && ['evento', 'atividade', 'gateway'].indexOf(spec.categoria(e.tipo)) !== -1) return e;
    }
    return null;
  }

  /**
   * Posiciona artefatos e objetos de dados. Quando ha associacao, o artefato
   * fica junto do elemento associado; caso contrario, abaixo do processo.
   */
  function posicionarSoltos(m, limites) {
    var ocupados = [];
    m.ordem.forEach(function (id) {
      var e = m.elementos[id];
      if (e.bounds && spec.categoria(e.tipo) !== 'container') ocupados.push(e.bounds);
    });

    function colide(b) {
      for (var i = 0; i < ocupados.length; i++) {
        var o = ocupados[i];
        if (b.x < o.x + o.width + 8 && b.x + b.width + 8 > o.x &&
            b.y < o.y + o.height + 8 && b.y + b.height + 8 > o.y) return true;
      }
      return false;
    }

    var x = limites.x + 40;
    var y = limites.y + limites.height + 40;

    m.ordem.forEach(function (id) {
      var e = m.elementos[id];
      if (e.bounds) return;
      if (['textAnnotation', 'group', 'dataObjectReference', 'dataStoreReference'].indexOf(e.tipo) === -1) return;
      var t = tamanhoPadrao(e.tipo);

      var parceiro = e.tipo === 'group' ? null : parceiroAssociado(m, id);
      if (parceiro) {
        var pb = parceiro.bounds;
        var cx = pb.x + pb.width / 2 - t.width / 2;
        // tenta acima, depois abaixo, depois ao lado
        var tentativas = [
          { x: cx, y: pb.y - t.height - 24 },
          { x: cx, y: pb.y + pb.height + 24 },
          { x: pb.x + pb.width + 24, y: pb.y },
          { x: pb.x - t.width - 24, y: pb.y }
        ];
        for (var k = 0; k < tentativas.length; k++) {
          var cand = { x: Math.round(tentativas[k].x), y: Math.round(tentativas[k].y), width: t.width, height: t.height };
          if (!colide(cand)) {
            e.bounds = cand;
            e.pai = parceiro.pai;
            e.participantId = parceiro.participantId || null;
            e.laneId = parceiro.laneId || null;
            ocupados.push(cand);
            break;
          }
        }
        if (e.bounds) return;
      }

      e.bounds = { x: x, y: y, width: t.width, height: t.height };
      ocupados.push(e.bounds);
      x += t.width + 30;
      if (x > limites.x + limites.width) { x = limites.x + 40; y += t.height + 30; }
    });
  }

  /** Layout de todo o modelo (piscinas empilhadas verticalmente). */
  function reorganizar(m) {
    var y = 80;
    var larguraMax = 900;
    var participantes = m.ordem
      .map(function (id) { return m.elementos[id]; })
      .filter(function (e) { return e.tipo === 'participant'; });

    if (participantes.length) {
      // primeira passada: descobre a maior largura
      participantes.forEach(function (p) {
        if (!p.processRef) return;
        var r = layoutProcesso(m, p.processRef, 160, y, 0);
        larguraMax = Math.max(larguraMax, r.largura);
      });
      y = 80;
      participantes.forEach(function (p) {
        var altura;
        if (p.processRef && m.processos[p.processRef]) {
          var r = layoutProcesso(m, p.processRef, 160, y + 0, larguraMax);
          altura = Math.max(r.altura, 100);
        } else {
          altura = 80; // caixa-preta
        }
        p.bounds = { x: 160, y: y, width: larguraMax, height: altura };
        p.isHorizontal = true;
        y += altura + 40;
      });
    } else {
      var pid = m.ordemProcessos[0];
      if (pid) {
        var res = layoutProcesso(m, pid, 100, 100, 0);
        larguraMax = res.largura;
        y = 100 + res.altura;
      }
    }

    posicionarBordas(m);

    // artefatos e dados sao reposicionados junto do elemento associado
    m.ordem.forEach(function (id) {
      var e = m.elementos[id];
      if (['textAnnotation', 'dataObjectReference', 'dataStoreReference'].indexOf(e.tipo) !== -1) e.bounds = null;
    });
    var lim = limites(m);
    posicionarSoltos(m, lim);
    ajustarContainersAoConteudo(m);

    m.ordemFluxos.forEach(function (fid) { m.fluxos[fid].waypoints = []; });
    return m;
  }

  /**
   * Cresce piscinas e raias para conter artefatos posicionados perto das
   * atividades, reempilhando as piscinas para que nao se sobreponham.
   */
  function ajustarContainersAoConteudo(m) {
    var participantes = m.ordem.map(function (id) { return m.elementos[id]; })
      .filter(function (e) { return e.tipo === 'participant' && e.bounds; });
    if (!participantes.length) return;

    participantes.forEach(function (p) {
      var raias = m.ordem.map(function (id) { return m.elementos[id]; })
        .filter(function (e) { return e.tipo === 'lane' && e.participantId === p.id && e.bounds; })
        .sort(function (a, b) { return a.bounds.y - b.bounds.y; });

      var extras = m.ordem.map(function (id) { return m.elementos[id]; })
        .filter(function (e) {
          if (['textAnnotation', 'dataObjectReference', 'dataStoreReference'].indexOf(e.tipo) === -1) return false;
          if (!e.bounds) return false;
          return donoDoArtefato(m, e) === p.id;
        });
      if (!extras.length) return;

      var topo = p.bounds.y;
      var base = p.bounds.y + p.bounds.height;
      extras.forEach(function (e) {
        topo = Math.min(topo, e.bounds.y - 20);
        base = Math.max(base, e.bounds.y + e.bounds.height + 20);
      });
      var cresceuTopo = p.bounds.y - topo;
      p.bounds.y = topo;
      p.bounds.height = base - topo;
      if (raias.length) {
        raias[0].bounds.y -= cresceuTopo;
        raias[0].bounds.height += cresceuTopo;
        var ultima = raias[raias.length - 1];
        ultima.bounds.height = (p.bounds.y + p.bounds.height) - ultima.bounds.y;
      }
    });

    // reempilha as piscinas mantendo 40px de folga
    participantes.sort(function (a, b) { return a.bounds.y - b.bounds.y; });
    var y = participantes[0].bounds.y;
    participantes.forEach(function (p) {
      var dy = y - p.bounds.y;
      if (dy) {
        deslocar(m, p, dy);
        p.bounds.y += dy;
      }
      y = p.bounds.y + p.bounds.height + 40;
    });
  }

  /** Piscina dona de um artefato: a propria, ou a do elemento associado. */
  function donoDoArtefato(m, e) {
    if (e.participantId) return e.participantId;
    var parceiro = parceiroAssociado(m, e.id);
    return parceiro ? (parceiro.participantId || null) : null;
  }

  function deslocar(m, participante, dy) {
    m.ordem.forEach(function (id) {
      var e = m.elementos[id];
      if (e === participante || !e.bounds) return;
      var pertence = e.participantId === participante.id ||
        (e.tipo === 'lane' && e.participantId === participante.id);
      if (!pertence && ['textAnnotation', 'dataObjectReference', 'dataStoreReference'].indexOf(e.tipo) !== -1) {
        pertence = donoDoArtefato(m, e) === participante.id;
      }
      if (pertence) e.bounds.y += dy;
    });
  }

  /** Garante que todo elemento tenha bounds; usa layout completo se faltar muito. */
  function garantirGeometria(m) {
    var relevantes = m.ordem.map(function (id) { return m.elementos[id]; })
      .filter(function (e) { return ['evento', 'atividade', 'gateway'].indexOf(spec.categoria(e.tipo)) !== -1; });
    if (!relevantes.length) return m;
    var semBounds = relevantes.filter(function (e) { return !e.bounds; });
    if (semBounds.length === 0) {
      posicionarBordas(m);
      posicionarSoltos(m, limites(m));
      garantirPiscinas(m);
      return m;
    }
    if (semBounds.length / relevantes.length > 0.3) return reorganizar(m);

    // poucos faltando: coloca a direita do predecessor
    semBounds.forEach(function (e) {
      var t = tamanhoPadrao(e.tipo);
      var ref = null;
      (e.entradas || []).forEach(function (fid) {
        var o = m.elementos[m.fluxos[fid].origem];
        if (o && o.bounds) ref = o;
      });
      if (ref) {
        e.bounds = { x: ref.bounds.x + ref.bounds.width + 60, y: ref.bounds.y + (ref.bounds.height - t.height) / 2, width: t.width, height: t.height };
      } else {
        var l = limites(m);
        e.bounds = { x: l.x + 40, y: l.y + l.height + 40, width: t.width, height: t.height };
      }
    });
    posicionarBordas(m);
    posicionarSoltos(m, limites(m));
    garantirPiscinas(m);
    return m;
  }

  /** Piscinas/raias sem geometria: envolvem seus filhos. */
  function garantirPiscinas(m) {
    m.ordem.forEach(function (id) {
      var e = m.elementos[id];
      if (e.tipo !== 'participant' && e.tipo !== 'lane') return;
      if (e.bounds) return;
      var filhosDoContainer = m.ordem.map(function (i) { return m.elementos[i]; })
        .filter(function (c) {
          if (!c.bounds) return false;
          return e.tipo === 'participant' ? c.participantId === e.id : c.laneId === e.id;
        });
      if (!filhosDoContainer.length) return;
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      filhosDoContainer.forEach(function (c) {
        minX = Math.min(minX, c.bounds.x); minY = Math.min(minY, c.bounds.y);
        maxX = Math.max(maxX, c.bounds.x + c.bounds.width); maxY = Math.max(maxY, c.bounds.y + c.bounds.height);
      });
      e.bounds = { x: minX - 60, y: minY - 40, width: (maxX - minX) + 120, height: (maxY - minY) + 80 };
      e.isHorizontal = true;
    });
  }

  function limites(m) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    m.ordem.forEach(function (id) {
      var b = m.elementos[id].bounds;
      if (!b) return;
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
    });
    m.ordemFluxos.forEach(function (fid) {
      (m.fluxos[fid].waypoints || []).forEach(function (w) {
        minX = Math.min(minX, w.x); minY = Math.min(minY, w.y);
        maxX = Math.max(maxX, w.x); maxY = Math.max(maxY, w.y);
      });
    });
    if (minX === Infinity) return { x: 0, y: 0, width: 800, height: 600 };
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  SB.layout = {
    reorganizar: reorganizar,
    garantirGeometria: garantirGeometria,
    garantirPiscinas: garantirPiscinas,
    limites: limites,
    tamanhoPadrao: tamanhoPadrao
  };
})(window);
