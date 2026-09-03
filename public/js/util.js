/* Simulador BPMN - utilitarios gerais (namespace global SB) */
(function (global) {
  'use strict';
  var SB = global.SB || (global.SB = {});

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    var n = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        if (attrs[k] === null || attrs[k] === undefined) continue;
        n.setAttribute(k, String(attrs[k]));
      }
    }
    if (parent) parent.appendChild(n);
    return n;
  }

  function h(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        if (k === 'class') n.className = attrs[k];
        else if (k === 'text') n.textContent = attrs[k];
        else if (k === 'html') n.innerHTML = attrs[k];
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, String(attrs[k]));
      }
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var contadorId = {};
  function uid(prefixo) {
    var p = prefixo || 'Id';
    contadorId[p] = (contadorId[p] || 0) + 1;
    return p + '_' + Date.now().toString(36).slice(-4) + contadorId[p];
  }

  function escapeXml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* -------------------------------------------------- geometria */

  function centro(b) { return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }

  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }

  /** Ponto onde a linha (de -> para) cruza a borda do retangulo b. */
  function ancoraRetangulo(b, alvo) {
    var c = centro(b);
    var dx = alvo.x - c.x;
    var dy = alvo.y - c.y;
    if (dx === 0 && dy === 0) return c;
    var hw = b.width / 2;
    var hh = b.height / 2;
    var escalaX = dx === 0 ? Infinity : hw / Math.abs(dx);
    var escalaY = dy === 0 ? Infinity : hh / Math.abs(dy);
    var s = Math.min(escalaX, escalaY);
    return { x: c.x + dx * s, y: c.y + dy * s };
  }

  function ancoraCirculo(b, alvo) {
    var c = centro(b);
    var r = Math.min(b.width, b.height) / 2;
    var d = dist(c, alvo);
    if (d === 0) return c;
    return { x: c.x + (alvo.x - c.x) * r / d, y: c.y + (alvo.y - c.y) * r / d };
  }

  /** Losango (gateway). */
  function ancoraLosango(b, alvo) {
    var c = centro(b);
    var dx = alvo.x - c.x;
    var dy = alvo.y - c.y;
    if (dx === 0 && dy === 0) return c;
    var hw = b.width / 2;
    var hh = b.height / 2;
    var t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    return { x: c.x + dx * t, y: c.y + dy * t };
  }

  /** Comprimento total de uma polilinha. */
  function comprimento(pts) {
    var t = 0;
    for (var i = 1; i < pts.length; i++) t += dist(pts[i - 1], pts[i]);
    return t;
  }

  /** Ponto a uma fracao 0..1 do caminho, com o angulo do segmento. */
  function pontoNoCaminho(pts, frac) {
    if (!pts || pts.length === 0) return { x: 0, y: 0, ang: 0 };
    if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, ang: 0 };
    var total = comprimento(pts);
    if (total === 0) return { x: pts[0].x, y: pts[0].y, ang: 0 };
    var alvo = Math.max(0, Math.min(1, frac)) * total;
    var acc = 0;
    for (var i = 1; i < pts.length; i++) {
      var d = dist(pts[i - 1], pts[i]);
      if (acc + d >= alvo || i === pts.length - 1) {
        var k = d === 0 ? 0 : (alvo - acc) / d;
        return {
          x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k,
          y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k,
          ang: Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x) * 180 / Math.PI
        };
      }
      acc += d;
    }
    var u = pts[pts.length - 1];
    return { x: u.x, y: u.y, ang: 0 };
  }

  /** Roteamento ortogonal simples entre dois retangulos. */
  function roteamentoOrtogonal(a, b) {
    var ca = centro(a);
    var cb = centro(b);
    var dx = cb.x - ca.x;
    var dy = cb.y - ca.y;
    var pts;
    if (Math.abs(dy) < 12) {
      pts = [{ x: dx >= 0 ? a.x + a.width : a.x, y: ca.y }, { x: dx >= 0 ? b.x : b.x + b.width, y: cb.y }];
    } else if (Math.abs(dx) < 12) {
      pts = [{ x: ca.x, y: dy >= 0 ? a.y + a.height : a.y }, { x: cb.x, y: dy >= 0 ? b.y : b.y + b.height }];
    } else if (Math.abs(dx) > Math.abs(dy)) {
      var sx = dx >= 0 ? a.x + a.width : a.x;
      var ex = dx >= 0 ? b.x : b.x + b.width;
      var mx = (sx + ex) / 2;
      pts = [{ x: sx, y: ca.y }, { x: mx, y: ca.y }, { x: mx, y: cb.y }, { x: ex, y: cb.y }];
    } else {
      var sy = dy >= 0 ? a.y + a.height : a.y;
      var ey = dy >= 0 ? b.y : b.y + b.height;
      var my = (sy + ey) / 2;
      pts = [{ x: ca.x, y: sy }, { x: ca.x, y: my }, { x: cb.x, y: my }, { x: cb.x, y: ey }];
    }
    return pts;
  }

  /* -------------------------------------------------- texto */

  /** Quebra texto em linhas que cabem em `largura` px (aprox. 6.1px por char em 12px). */
  function quebrarTexto(texto, largura, tamanhoFonte) {
    var t = String(texto || '').trim();
    if (!t) return [];
    var chars = Math.max(6, Math.floor(largura / ((tamanhoFonte || 12) * 0.52)));
    var palavras = t.split(/\s+/);
    var linhas = [];
    var atual = '';
    for (var i = 0; i < palavras.length; i++) {
      var p = palavras[i];
      if (!atual) {
        atual = p;
      } else if ((atual + ' ' + p).length <= chars) {
        atual += ' ' + p;
      } else {
        linhas.push(atual);
        atual = p;
      }
      while (atual.length > chars) {
        linhas.push(atual.slice(0, chars - 1) + '-');
        atual = atual.slice(chars - 1);
      }
    }
    if (atual) linhas.push(atual);
    return linhas;
  }

  /** Formata segundos simulados em h/min/s legiveis. */
  function formatarDuracao(seg) {
    var s = Math.max(0, Math.round(seg));
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    var r = s % 60;
    if (m < 60) return m + 'min' + (r ? ' ' + r + 's' : '');
    var hh = Math.floor(m / 60);
    var mm = m % 60;
    if (hh < 24) return hh + 'h' + (mm ? ' ' + mm + 'min' : '');
    var dd = Math.floor(hh / 24);
    return dd + 'd ' + (hh % 24) + 'h';
  }

  function formatarNumero(n, casas) {
    var c = casas === undefined ? 1 : casas;
    if (!isFinite(n)) return '-';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
  }

  /** Sorteio triangular simples entre min e max (mais realista que uniforme). */
  function amostraDuracao(min, max) {
    var a = Math.max(0, Number(min) || 0);
    var b = Math.max(a, Number(max) || a);
    if (b === a) return a;
    var u = Math.random();
    var v = Math.random();
    return a + (b - a) * ((u + v) / 2);
  }

  SB.util = {
    SVG_NS: SVG_NS,
    el: el,
    h: h,
    $: $,
    $$: $$,
    uid: uid,
    escapeXml: escapeXml,
    escapeHtml: escapeHtml,
    centro: centro,
    dist: dist,
    ancoraRetangulo: ancoraRetangulo,
    ancoraCirculo: ancoraCirculo,
    ancoraLosango: ancoraLosango,
    comprimento: comprimento,
    pontoNoCaminho: pontoNoCaminho,
    roteamentoOrtogonal: roteamentoOrtogonal,
    quebrarTexto: quebrarTexto,
    formatarDuracao: formatarDuracao,
    formatarNumero: formatarNumero,
    amostraDuracao: amostraDuracao
  };
})(window);
