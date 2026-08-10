/**
 * Single round-robin pairings by the circle method.
 * An odd roster gets a null placeholder, and whoever is paired with it
 * has the bye that round.
 */
export function circleRounds(ids) {
  const list = [...ids];
  if (list.length % 2 === 1) list.push(null);

  const size = list.length;
  const anchor = list[0];
  let rotating = list.slice(1);
  const rounds = [];

  for (let round = 0; round < size - 1; round += 1) {
    const line = [anchor, ...rotating];
    const pairs = [];
    for (let i = 0; i < size / 2; i += 1) {
      const p1 = line[i];
      const p2 = line[size - 1 - i];
      if (p1 !== null && p2 !== null) pairs.push([p1, p2]);
    }
    rounds.push(pairs);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return rounds;
}

/**
 * Double round-robin fixtures for one group. The second half repeats the
 * first with the players swapped, so each pair gets first serve once.
 */
export function generateGroupFixtures(groupName, ids) {
  const single = circleRounds(ids);
  const fixtures = [];

  const emit = (pairs, roundNumber, reversed) => {
    pairs.forEach(([first, second], index) => {
      fixtures.push({
        id: `${groupName}-R${roundNumber}-M${index + 1}`,
        stage: 'group',
        group: groupName,
        round: roundNumber,
        p1: reversed ? second : first,
        p2: reversed ? first : second,
      });
    });
  };

  single.forEach((pairs, index) => emit(pairs, index + 1, false));
  single.forEach((pairs, index) => emit(pairs, single.length + index + 1, true));

  return fixtures;
}
