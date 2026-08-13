export const ROSTER = [
  { id: 'aytac', name: 'Aytaç Ç.', short: 'Aytaç Ç.', slackId: 'U09CYKX6JHY' },
  { id: 'emre-y', name: 'Emre Y.', short: 'Emre Y.', slackId: 'U09DSGTCFAL' },
  { id: 'tolga', name: 'Tolga E.', short: 'Tolga E.', slackId: 'U09LQ3PF6LC' },
  { id: 'emre-k', name: 'Emre K.', short: 'Emre K.', slackId: 'U0A68UYA1NX' },
  { id: 'defne', name: 'Defne G.', short: 'Defne G.', slackId: 'U0AFYKZMJEN' },
  // Surname initial taken from the username (necmettin.colakoglu); his Slack
  // profile carries a first name only.
  { id: 'necmettin', name: 'Necmettin Ç.', short: 'Necmettin Ç.', slackId: 'U0AN3LWT6H3' },
  { id: 'omer', name: 'Ömer D.', short: 'Ömer D.', slackId: 'U0APG48TL67' },
  { id: 'mirza', name: 'Mirza Ş.', short: 'Mirza Ş.', slackId: 'U0AT8HQ7C9K' },
  { id: 'dogukan', name: 'Doğukan D.', short: 'Doğukan D.', slackId: 'U0B3Q4A63DL' },
  { id: 'emre-b', name: 'Emre B.', short: 'Emre B.', slackId: 'U0BE7QDL98B' },
  { id: 'tugberk', name: 'Tuğberk G.', short: 'Tuğberk G.', slackId: 'U0BEE57LQ90' },
  // No Slack id: he is not in the tournament channel. Nothing depends on one —
  // playerForSlackId refuses to match an absent identity, and the passphrase
  // sign-in keys on the roster id — but he can never be an admin without it.
  { id: 'ibrahim', name: 'İbrahim A.', short: 'İbrahim A.' },
  // Joins at the quarter-final as the eighth entrant and plays no group stage,
  // so the draw must exclude him — the twelve group-stage players below are what
  // make the groups 6 and 6, and counting him would leave 7 and 6.
  { id: 'tugkan', name: 'Tuğkan T.', short: 'Tuğkan T.', slackId: 'U094H3DBEUW', groupStage: false },
];

export const SEASON = {
  id: '2026-autumn',
  name: 'Efsora Table Tennis League',
  startDate: '2026-08-17',
  drawSeed: 20260810,
  admins: ['U0AT8HQ7C9K'],
};

export const RULES = {
  matchFormat: 'best-of-3',
  // The load-bearing one: everything that validates a score reads this, so the
  // format is defined here and nowhere else. `matchFormat` above is the label.
  gamesToWin: 2,
  gameTarget: 11,
  pointsWin: 3,
  pointsLoss: 0,
  tiebreakOrder: ['headToHead', 'gameDiff', 'gamesWon', 'seededDraw'],
};
