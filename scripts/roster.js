export const ROSTER = [
  { id: 'aytac', name: 'Aytaç Ç.', short: 'Aytaç Ç.', slackId: 'U09CYKX6JHY' },
  { id: 'emre-y', name: 'Emre Y.', short: 'Emre Y.', slackId: 'U09DSGTCFAL' },
  { id: 'tolga', name: 'Tolga E.', short: 'Tolga E.', slackId: 'U09LQ3PF6LC' },
  { id: 'emre-k', name: 'Emre K.', short: 'Emre K.', slackId: 'U0A68UYA1NX' },
  { id: 'defne', name: 'Defne G.', short: 'Defne G.', slackId: 'U0AFYKZMJEN' },
  { id: 'omer', name: 'Ömer D.', short: 'Ömer D.', slackId: 'U0APG48TL67' },
  { id: 'mirza', name: 'Mirza Ş.', short: 'Mirza Ş.', slackId: 'U0AT8HQ7C9K' },
  { id: 'dogukan', name: 'Doğukan D.', short: 'Doğukan D.', slackId: 'U0B3Q4A63DL' },
  { id: 'emre-b', name: 'Emre B.', short: 'Emre B.', slackId: 'U0BE7QDL98B' },
  { id: 'tugberk', name: 'Tuğberk G.', short: 'Tuğberk G.', slackId: 'U0BEE57LQ90' },
  { id: 'can', name: 'Can K.', short: 'Can K.', slackId: 'U0BJ863HCNP' },
];

export const SEASON = {
  id: '2026-autumn',
  name: 'Efsora Table Tennis League',
  startDate: '2026-08-10',
  drawSeed: 20260810,
  admins: ['U0AT8HQ7C9K'],
};

export const RULES = {
  matchFormat: 'best-of-5',
  gameTarget: 11,
  pointsWin: 3,
  pointsLoss: 0,
  tiebreakOrder: ['headToHead', 'gameDiff', 'gamesWon', 'seededDraw'],
};
