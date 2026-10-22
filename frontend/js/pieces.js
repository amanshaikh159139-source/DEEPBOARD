/*
 * pieces.js
 * =========
 * The chess pieces, drawn as SVG (no image files, no fonts needed).
 *
 *   Pieces.svg('N')   -> markup for a white knight   (uppercase = white)
 *   Pieces.svg('n')   -> markup for a black knight   (lowercase = black)
 *
 * Every piece is a list of shapes in a 45 x 45 box.  The shapes are painted
 * twice: first with a thick outline colour, then with the fill colour on
 * top - this gives one clean outline around the whole piece.
 * Want different colours?  Change the PALETTE below.
 */
(function (root) {
  'use strict';

  var PALETTE = {
    w: { fill: '#F8F6F1', line: '#1B2733', detail: '#1B2733' },
    b: { fill: '#2C3A49', line: '#0E161E', detail: '#C9D3DD' }
  };

  // Each piece: { shapes: [svg shapes], details: [svg detail strokes] }
  var SHAPES = {
    p: {
      shapes: [
        '<circle cx="22.5" cy="13.5" r="5.6"/>',
        '<path d="M17.2 20.5h10.6c-.9 4.6 1.4 7.2 3.6 9.6 1.4 1.6 1.6 3.4 1.6 6.4H12c0-3 .2-4.8 1.6-6.4 2.2-2.4 4.5-5 3.6-9.6z"/>',
        '<rect x="10.5" y="35.5" width="24" height="4.5" rx="2"/>'
      ],
      details: ['<path d="M16.2 30.2h12.6" fill="none"/>']
    },
    r: {
      shapes: [
        '<path d="M13 8h5v3.2h3V8h3v3.2h3V8h5v9.5H13z"/>',
        '<path d="M15 17.5h15l1.4 18H13.6z"/>',
        '<rect x="10.5" y="35" width="24" height="5" rx="2"/>'
      ],
      details: ['<path d="M13.2 17.6h18.6M14.2 26.5h16.6" fill="none"/>']
    },
    n: {
      shapes: [
        '<path d="M13 36C12.4 30 14.8 26.4 19.6 22.6c-2-.2-3.6.6-5.4 2.6l-2.8-1.2c-.6-3 1.8-5 4.2-7.8 1.2-1.6 1.4-3.4 1.2-5.6l3.2 2.2c1.4-1.6 2.6-3 3.6-4.6l1.4 3.2c7.8 1.8 11.6 8.6 11.6 17.4 0 3.4-.6 6.4-.8 10.2z"/>',
        '<rect x="10.5" y="35.5" width="24" height="4.5" rx="2"/>'
      ],
      details: [
        '<circle cx="19.4" cy="15.2" r="1.25" stroke="none" fill="__DETAIL__"/>',
        '<path d="M12.2 22.6l1.8.6" fill="none"/>',
        '<path d="M24.4 11.4c4.4 1.4 7.2 5.6 7.8 11" fill="none"/>'
      ]
    },
    b: {
      shapes: [
        '<circle cx="22.5" cy="7.6" r="2.9"/>',
        '<path d="M22.5 10c4.6 3.6 7.6 8 6.4 12.6-.6 2.2-2 3.6-3.6 4.6 3.4 1.6 5.2 4.6 4.7 8.8H14.1c-.5-4.2 1.3-7.2 4.7-8.8-1.6-1-3-2.4-3.6-4.6C14 18 17.9 13.6 22.5 10z"/>',
        '<rect x="10.5" y="35.5" width="24" height="4.5" rx="2"/>'
      ],
      details: ['<path d="M22.4 14.2l3.6 5.2M16.4 28.4h12.2" fill="none"/>']
    },
    q: {
      shapes: [
        '<circle cx="10.6" cy="12.4" r="2.5"/><circle cx="16.6" cy="9" r="2.5"/><circle cx="22.5" cy="7.6" r="2.7"/><circle cx="28.4" cy="9" r="2.5"/><circle cx="34.4" cy="12.4" r="2.5"/>',
        '<path d="M13.4 36 10.4 14.4l4.1 10.4 2.1-14 3.3 13.4L22.5 9l2.6 15.2 3.3-13.4 2.1 14 4.1-10.4L31.6 36z"/>',
        '<rect x="10.5" y="35" width="24" height="5" rx="2"/>'
      ],
      details: ['<path d="M14.2 31.2h16.6" fill="none"/>']
    },
    k: {
      shapes: [
        '<path d="M20.9 2.8h3.2v2.7h2.8v3.1h-2.8v2.9h-3.2V8.6h-2.8V5.5h2.8z"/>',
        '<path d="M22.5 11.5c6.6 0 10.6 4.4 9.2 9.2-.6 2.2-2.2 3.6-3.8 4.6 3.4 1.8 5.2 4.6 4.6 10.7H12.5c-.6-6.1 1.2-8.9 4.6-10.7-1.6-1-3.2-2.4-3.8-4.6-1.4-4.8 2.6-9.2 9.2-9.2z"/>',
        '<rect x="10.5" y="35" width="24" height="5" rx="2"/>'
      ],
      details: ['<path d="M15.2 29.6h14.6" fill="none"/>']
    }
  };

  var cache = {};

  function build(ch) {
    var color = ch === ch.toUpperCase() ? 'w' : 'b';
    var def = SHAPES[ch.toLowerCase()];
    var pal = PALETTE[color];
    var shapes = def.shapes.join('');
    var details = def.details.join('').replace(/__DETAIL__/g, pal.detail);
    return '<svg class="piece" viewBox="0 0 45 45" aria-hidden="true" focusable="false">' +
      '<g fill="' + pal.line + '" stroke="' + pal.line + '" stroke-width="3.2" stroke-linejoin="round">' + shapes + '</g>' +
      '<g fill="' + pal.fill + '" stroke="none">' + shapes + '</g>' +
      '<g stroke="' + pal.detail + '" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' + details + '</g>' +
      '</svg>';
  }

  root.Pieces = {
    PALETTE: PALETTE,
    svg: function (ch) {
      return cache[ch] || (cache[ch] = build(ch));
    },
    NAMES: { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }
  };
})(typeof window !== 'undefined' ? window : globalThis);
