/*
 * board.js
 * ========
 * The chessboard component.  It only DRAWS the board and reports what the
 * user tried to do - the rules live in chess-rules.js, the game flow in
 * play.js / analysis.js.
 *
 *   var board = new Board(element, {
 *     orientation: 'w',
 *     canSelect: function (square) { return true; },       // may this piece be picked up?
 *     getTargets: function (square) { return ['e3','e4']; }, // squares it can go to
 *     onMove: function (from, to) { ... }                    // user dropped / clicked a target
 *   });
 *   board.setPosition(fen, lastMove);   board.flip();   board.setArrows([...]) ...
 */
(function (root) {
  'use strict';

  var FILES = 'abcdefgh';

  function Board(container, options) {
    this.root = container;
    this.opts = Object.assign({
      orientation: 'w',
      interactive: true,
      coordinates: true,
      canSelect: function () { return false; },
      getTargets: function () { return []; },
      onMove: function () {}
    }, options || {});

    this.orientation = this.opts.orientation;
    this.interactive = this.opts.interactive;
    this.pieces = {};          // square -> piece letter
    this.lastMove = null;      // ['e2','e4']
    this.checkSquare = null;
    this.hintSquares = [];
    this.badge = null;         // { square, mark, color }
    this.selected = null;
    this.targets = [];
    this.drag = null;
    this.squares = {};

    this.root.classList.add('board');
    this._build();
    this._bind();
  }

  // ---- construction ---------------------------------------------------------
  Board.prototype._build = function () {
    var self = this;
    U.clear(this.root);
    this.squares = {};

    var grid = U.el('div', { class: 'board-grid' });
    for (var row = 0; row < 8; row++) {
      for (var col = 0; col < 8; col++) {
        var file = this.orientation === 'w' ? col : 7 - col;
        var rank = this.orientation === 'w' ? 7 - row : row;
        var name = FILES[file] + (rank + 1);
        var sq = U.el('div', { class: 'sq ' + (((file + rank) % 2 === 0) ? 'dark' : 'light'), 'data-sq': name });
        if (this.opts.coordinates) {
          if (row === 7) sq.appendChild(U.el('span', { class: 'coord file', text: FILES[file] }));
          if (col === 0) sq.appendChild(U.el('span', { class: 'coord rank', text: String(rank + 1) }));
        }
        grid.appendChild(sq);
        this.squares[name] = sq;
      }
    }
    this.grid = grid;
    this.root.appendChild(grid);

    // arrows layer (SVG, one unit = one square)
    this.arrowLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.arrowLayer.setAttribute('class', 'board-arrows');
    this.arrowLayer.setAttribute('viewBox', '0 0 8 8');
    this.arrowLayer.setAttribute('aria-hidden', 'true');
    this.root.appendChild(this.arrowLayer);

    this.overlay = U.el('div', { class: 'board-overlay', hidden: true });
    this.root.appendChild(this.overlay);

    this.render();
    if (this.arrows) this.setArrows(this.arrows);
    self.root.setAttribute('role', 'img');
    self.root.setAttribute('aria-label', 'Chessboard');
  };

  // ---- rendering ------------------------------------------------------------
  Board.prototype.setPosition = function (fen, lastMove, animate) {
    var placement = fen.split(' ')[0].split('/');
    var next = {};
    for (var r = 0; r < 8; r++) {
      var file = 0;
      for (var i = 0; i < placement[r].length; i++) {
        var ch = placement[r][i];
        if (ch >= '1' && ch <= '8') file += parseInt(ch, 10);
        else { next[FILES[file] + (8 - r)] = ch; file++; }
      }
    }
    this.pieces = next;
    this.lastMove = lastMove || null;
    this.clearSelection(true);
    this.render();
    if (animate && lastMove) this._animate(lastMove[0], lastMove[1]);
  };

  Board.prototype.render = function () {
    var names = Object.keys(this.squares);
    for (var i = 0; i < names.length; i++) {
      var name = names[i], sq = this.squares[name];
      var old = sq.querySelector('.piece-holder');
      var ch = this.pieces[name];

      if (old && old.getAttribute('data-p') !== (ch || '')) { sq.removeChild(old); old = null; }
      if (ch && !old) {
        var holder = U.el('div', { class: 'piece-holder', 'data-p': ch, html: Pieces.svg(ch) });
        sq.appendChild(holder);
      }

      var cls = 'sq ' + (sq.classList.contains('dark') ? 'dark' : 'light');
      if (this.lastMove && (this.lastMove[0] === name || this.lastMove[1] === name)) cls += ' last';
      if (this.selected === name) cls += ' selected';
      if (this.targets.indexOf(name) >= 0) cls += this.pieces[name] ? ' target capture' : ' target';
      if (this.checkSquare === name) cls += ' check';
      if (this.hintSquares.indexOf(name) >= 0) cls += ' hint';
      sq.className = cls;

      var badge = sq.querySelector('.badge');
      if (this.badge && this.badge.square === name) {
        if (!badge) { badge = U.el('span', { class: 'badge' }); sq.appendChild(badge); }
        badge.textContent = this.badge.mark;
        badge.style.background = this.badge.color;
      } else if (badge) {
        sq.removeChild(badge);
      }
    }
  };

  Board.prototype._animate = function (from, to) {
    var a = this.squares[from], b = this.squares[to];
    var holder = b && b.querySelector('.piece-holder');
    if (!a || !b || !holder || !holder.animate) return;
    var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    var dx = ra.left - rb.left, dy = ra.top - rb.top;
    if (!dx && !dy) return;
    holder.style.zIndex = 5;
    var anim = holder.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'translate(0,0)' }],
      { duration: 150, easing: 'cubic-bezier(.2,.7,.3,1)' });
    anim.onfinish = anim.oncancel = function () { holder.style.zIndex = ''; };
  };

  Board.prototype.setCheck = function (square) { this.checkSquare = square || null; this.render(); };
  Board.prototype.setHint = function (squares) { this.hintSquares = squares || []; this.render(); };
  Board.prototype.setBadge = function (badge) { this.badge = badge || null; this.render(); };
  Board.prototype.setInteractive = function (flag) { this.interactive = !!flag; if (!flag) this.clearSelection(); };

  Board.prototype.flip = function () { this.setOrientation(this.orientation === 'w' ? 'b' : 'w'); };
  Board.prototype.setOrientation = function (color) {
    if (color === this.orientation) return;
    this.orientation = color;
    this._build();
  };

  /** Draw arrows: [{from:'e2', to:'e4', color:'#1F9D6B'}] */
  Board.prototype.setArrows = function (arrows) {
    this.arrows = arrows || [];
    var svg = this.arrowLayer, orientation = this.orientation;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    function center(name) {
      var f = FILES.indexOf(name[0]), r = parseInt(name[1], 10) - 1;
      return orientation === 'w' ? { x: f + 0.5, y: 7 - r + 0.5 } : { x: 7 - f + 0.5, y: r + 0.5 };
    }
    this.arrows.forEach(function (a) {
      var p = center(a.from), q = center(a.to);
      var dx = q.x - p.x, dy = q.y - p.y, len = Math.sqrt(dx * dx + dy * dy);
      if (!len) return;
      var ux = dx / len, uy = dy / len, head = 0.42, width = 0.16;
      var ex = q.x - ux * head, ey = q.y - uy * head;           // where the line ends and the head begins
      var sx = p.x + ux * 0.18, sy = p.y + uy * 0.18;
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', sx); line.setAttribute('y1', sy); line.setAttribute('x2', ex); line.setAttribute('y2', ey);
      line.setAttribute('stroke', a.color || '#1B5A73'); line.setAttribute('stroke-width', width);
      line.setAttribute('stroke-linecap', 'round'); line.setAttribute('opacity', '0.85');
      var tip = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      var nx = -uy, ny = ux, hw = 0.3;
      tip.setAttribute('points', [q.x - ux * 0.04, q.y - uy * 0.04, ex + nx * hw, ey + ny * hw, ex - nx * hw, ey - ny * hw].join(','));
      tip.setAttribute('fill', a.color || '#1B5A73'); tip.setAttribute('opacity', '0.85');
      svg.appendChild(line); svg.appendChild(tip);
    });
  };

  // ---- selection -------------------------------------------------------------
  Board.prototype.select = function (square) {
    this.selected = square;
    this.targets = square ? this.opts.getTargets(square) || [] : [];
    this.render();
  };
  Board.prototype.clearSelection = function (silent) {
    this.selected = null; this.targets = [];
    if (!silent) this.render();
  };

  // ---- promotion picker ---------------------------------------------------------
  /** Shows Queen / Rook / Bishop / Knight buttons. Resolves with 'q','r','b','n' (or null if cancelled). */
  Board.prototype.askPromotion = function (color) {
    var self = this;
    return new Promise(function (resolve) {
      var box = U.el('div', { class: 'promo-box', role: 'dialog', 'aria-label': 'Choose a piece to promote to' });
      function done(value) { self.overlay.hidden = true; U.clear(self.overlay); resolve(value); }
      ['q', 'n', 'r', 'b'].forEach(function (t) {
        var letter = color === 'w' ? t.toUpperCase() : t;
        box.appendChild(U.el('button', { class: 'promo-choice', type: 'button', title: Pieces.NAMES[t], 'aria-label': Pieces.NAMES[t], html: Pieces.svg(letter), onclick: function () { done(t); } }));
      });
      var cancel = U.el('button', { class: 'promo-cancel', type: 'button', text: 'Cancel', onclick: function () { done(null); } });
      U.clear(self.overlay);
      self.overlay.appendChild(U.el('div', { class: 'promo-wrap' }, U.el('p', { class: 'promo-title', text: 'Promote the pawn to' }), box, cancel));
      self.overlay.hidden = false;
      var first = box.querySelector('button'); if (first) first.focus();
    });
  };

  // ---- pointer handling (click + drag) -------------------------------------------
  Board.prototype._squareAt = function (clientX, clientY) {
    var rect = this.grid.getBoundingClientRect();
    var x = (clientX - rect.left) / rect.width, y = (clientY - rect.top) / rect.height;
    if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
    var col = Math.floor(x * 8), row = Math.floor(y * 8);
    var file = this.orientation === 'w' ? col : 7 - col;
    var rank = this.orientation === 'w' ? 7 - row : row;
    return FILES[file] + (rank + 1);
  };

  Board.prototype._bind = function () {
    var self = this;

    this.root.addEventListener('pointerdown', function (e) {
      if (!self.interactive || e.button > 0 || !self.overlay.hidden) return;
      var name = self._squareAt(e.clientX, e.clientY);
      if (!name) return;

      // second click of a click-click move
      if (self.selected && self.targets.indexOf(name) >= 0) {
        var from = self.selected;
        self.clearSelection();
        self.opts.onMove(from, name);
        return;
      }

      if (self.pieces[name] && self.opts.canSelect(name)) {
        var wasSelected = self.selected === name;
        self.select(name);
        self.drag = { from: name, startX: e.clientX, startY: e.clientY, active: false, ghost: null, wasSelected: wasSelected, id: e.pointerId };
        try { self.root.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
        e.preventDefault();
      } else {
        self.clearSelection();
      }
    });

    this.root.addEventListener('pointermove', function (e) {
      var d = self.drag;
      if (!d) return;
      if (!d.active) {
        if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 6) return;
        d.active = true;
        var holder = self.squares[d.from].querySelector('.piece-holder');
        var size = self.grid.getBoundingClientRect().width / 8;
        d.ghost = U.el('div', { class: 'drag-ghost', html: Pieces.svg(self.pieces[d.from]) });
        d.ghost.style.width = d.ghost.style.height = size * 1.1 + 'px';
        document.body.appendChild(d.ghost);
        if (holder) holder.style.opacity = '0.25';
      }
      d.ghost.style.left = e.clientX + 'px';
      d.ghost.style.top = e.clientY + 'px';
    });

    function finish(e, cancelled) {
      var d = self.drag;
      if (!d) return;
      self.drag = null;
      try { self.root.releasePointerCapture(d.id); } catch (err) { /* ignore */ }
      if (d.ghost) document.body.removeChild(d.ghost);
      var holder = self.squares[d.from] && self.squares[d.from].querySelector('.piece-holder');
      if (holder) holder.style.opacity = '';

      if (d.active) {
        var target = cancelled ? null : self._squareAt(e.clientX, e.clientY);
        if (target && target !== d.from && self.targets.indexOf(target) >= 0) {
          var from = d.from;
          self.clearSelection();
          self.opts.onMove(from, target);
        } else {
          self.clearSelection();       // dropped somewhere illegal: the piece snaps back
        }
      } else if (d.wasSelected) {
        self.clearSelection();         // tapped the selected piece again: deselect
      }
    }
    this.root.addEventListener('pointerup', function (e) { finish(e, false); });
    this.root.addEventListener('pointercancel', function (e) { finish(e, true); });
    this.root.addEventListener('dragstart', function (e) { e.preventDefault(); });
  };

  root.Board = Board;
})(window);
