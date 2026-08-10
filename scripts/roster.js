export const ROSTER = [
  { id: 'aytac', name: 'Aytaç Çeliktuğ', short: 'Çeliktuğ', slackId: 'U09CYKX6JHY' },
  { id: 'emre-y', name: 'Emre Yıldız', short: 'Yıldız', slackId: 'U09DSGTCFAL' },
  { id: 'tolga', name: 'Tolga Erdönmez', short: 'Erdönmez', slackId: 'U09LQ3PF6LC' },
  { id: 'emre-k', name: 'Emre Kuru', short: 'Kuru', slackId: 'U0A68UYA1NX' },
  { id: 'defne', name: 'Defne Gökner', short: 'Gökner', slackId: 'U0AFYKZMJEN' },
  { id: 'omer', name: 'Ömer Yiğit Davran', short: 'Davran', slackId: 'U0APG48TL67' },
  { id: 'mirza', name: 'Mirza Şahinkaya', short: 'Şahinkaya', slackId: 'U0AT8HQ7C9K' },
  { id: 'dogukan', name: 'Doğukan Demirel', short: 'Demirel', slackId: 'U0B3Q4A63DL' },
  { id: 'emre-b', name: 'Emre Beceriklican', short: 'Beceriklican', slackId: 'U0BE7QDL98B' },
  { id: 'tugberk', name: 'Tuğberk Göktepe', short: 'Göktepe', slackId: 'U0BEE57LQ90' },
  { id: 'can', name: 'Can Kaya', short: 'Kaya', slackId: 'U0BJ863HCNP' },
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
