/*
 * config.js
 * =========
 * Settings you may want to change.  Everything else in the app reads from here.
 */
window.CONFIG = {
  // Where the Flask backend lives.
  //  The app first tries the same address the page was opened from (this is the normal case:
  //  you open http://127.0.0.1:5050 and Flask serves both the page and the API).
  //  If that does not answer - for example you opened index.html with VS Code "Live Server" or
  //  straight from the folder - it tries BACKEND_URL instead.
  //  Started Flask on another port?  Change the port in BACKEND_URL.
  BACKEND_URL: 'http://127.0.0.1:5050',
  API_BASE: location.protocol === 'file:' ? 'http://127.0.0.1:5050' : '',   // filled in by api.js (Engine.init)
  // Set this public OAuth client ID and the same GOOGLE_CLIENT_ID in the backend environment.
  GOOGLE_CLIENT_ID: '234892514053-7akhfdsl1f1q76udpkaicl8cuginr6a7.apps.googleusercontent.com',

  // Play vs Bot: text shown next to the level slider (1 = beginner, 7 = full-strength engine)
  BOT_LEVELS: [
    null,
    { name: 'Beginner · 200',       hint: 'forgiving beginner practice; approximate strength 200', rating: 200, avatar: 'beginner.svg' },
    { name: 'Casual · 800',         hint: 'basic tactics; approximate strength 800', rating: 800, avatar: 'casual.svg' },
    { name: 'Club Player · 1500',   hint: 'intermediate tactics; approximate strength 1500', rating: 1500, avatar: 'club.svg' },
    { name: 'Advanced · 1800',      hint: 'strong club-level challenge; approximate strength 1800', rating: 1800, avatar: 'advanced.svg' },
    { name: 'Expert · 2000',        hint: 'advanced tactical play; approximate strength 2000', rating: 2000, avatar: 'expert.svg' },
    { name: 'Master · 2500',        hint: 'very strong challenge; approximate strength 2500', rating: 2500, avatar: 'master.svg' },
    { name: 'Stockfish',            hint: 'full-strength installed engine; rating varies by hardware and time', rating: null, avatar: 'stockfish.svg' }
  ],



  // Game analysis: how long the engine thinks about each position (milliseconds)
  ANALYSIS_SPEEDS: [
    { id: 'quick',    label: 'Quick',    movetime: 120,  hint: 'a few seconds for a whole game' },
    { id: 'balanced', label: 'Balanced', movetime: 350,  hint: 'recommended' },
    { id: 'deep',     label: 'Deep',     movetime: 1000, hint: 'about a minute for 40 moves' }
  ],
  DEFAULT_SPEED: 'balanced',

  // Move classification: centipawns lost compared with the engine's best line.
  // A move is given the first label whose "max" it does not exceed.
  CLASSES: [
    { id: 'best',       label: 'Best',       max: 5,        mark: '★', color: '#1F9D6B' },
    { id: 'excellent',  label: 'Excellent',  max: 25,       mark: '!',      color: '#5FA845' },
    { id: 'good',       label: 'Good',       max: 50,       mark: '✓', color: '#7F95A8' },
    { id: 'inaccuracy', label: 'Inaccuracy', max: 100,      mark: '?!',     color: '#D9A000' },
    { id: 'mistake',    label: 'Mistake',    max: 250,      mark: '?',      color: '#E07B2A' },
    { id: 'blunder',    label: 'Blunder',    max: Infinity, mark: '??',     color: '#D14343' }
  ],

  // Evaluations are clamped to this many centipawns when measuring move quality
  EVAL_CLAMP: 1000,

  // How many games to fetch from chess.com
  CHESSCOM_MAX_GAMES: 25,

  // Board colour themes (the player picks one in the header)
  BOARD_THEMES: {
    slate:  { name: 'Slate',  light: '#DEE6EC', dark: '#6D8CA3' },
    forest: { name: 'Forest', light: '#E9EBD3', dark: '#6F9A62' },
    walnut: { name: 'Walnut', light: '#EBD7B8', dark: '#A8764B' },
    plum:   { name: 'Plum',   light: '#E8E1EE', dark: '#8A72A6' }
  },
  DEFAULT_BOARD_THEME: 'slate',
  UI_THEMES: {
    teal: { name: 'Ocean teal', petrol: '#1B5A73', deep: '#12445A', tint: '#DCEBF1' },
    blue: { name: 'Blue', petrol: '#315DB8', deep: '#21458F', tint: '#E0E9FF' },
    purple: { name: 'Purple', petrol: '#7450A8', deep: '#553781', tint: '#EEE5FA' },
    emerald: { name: 'Emerald', petrol: '#187A58', deep: '#10573D', tint: '#D9F2E7' },
    amber: { name: 'Amber', petrol: '#A75D18', deep: '#7D4310', tint: '#F9E9D7' }
  },
  DEFAULT_UI_THEME: 'teal',

  // localStorage keys
  STORAGE: {
    history: 'deepboard.history.v1',
    theme: 'deepboard.boardTheme',
    uiTheme: 'deepboard.uiTheme',
    playPrefs: 'deepboard.playPrefs'
  },
  HISTORY_LIMIT: 200
};
