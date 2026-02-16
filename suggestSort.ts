
import { Card } from './types.js';
import { sortCards } from './ruleValidator.js';

/**
 * NEW FEATURE START
 * Logic to suggest the best arrangement of cards on hand.
 * Priority: Four of a Kind > Longest Straights > Triples > Pairs > Singles.
 * Returns a new array with the recommended visual order.
 */
export function suggestBestArrangement(cards: Card[]): Card[] {
  if (cards.length === 0) return [];

  let pool = [...cards];
  const groups: Card[][] = [];

  const removeFromPool = (toRemove: Card[]) => {
    const ids = new Set(toRemove.map(c => c.id));
    pool = pool.filter(c => !ids.has(c.id));
  };

  // 1. Detect Four of a Kind (Tứ quý)
  const findFourOfAKind = () => {
    const rankCounts: Record<number, Card[]> = {};
    pool.forEach(c => {
      if (!rankCounts[c.rank]) rankCounts[c.rank] = [];
      rankCounts[c.rank].push(c);
    });
    
    Object.values(rankCounts).forEach(group => {
      if (group.length === 4) {
        groups.push(sortCards(group));
        removeFromPool(group);
      }
    });
  };

  // 2. Detect Longest Straights (Sảnh) - Min length 3, Excludes Rank 15 (2)
  const findStraights = () => {
    // Need to handle branching straights, but simple greedy approach usually works for UI suggestion
    let found;
    do {
      found = false;
      const sortedPool = sortCards(pool).filter(c => c.rank < 15);
      const distinctRanks = Array.from(new Set(sortedPool.map(c => c.rank))).sort((a, b) => a - b);
      
      let longest: Card[] = [];
      for (let i = 0; i < distinctRanks.length; i++) {
        const currentStraight: Card[] = [];
        for (let j = i; j < distinctRanks.length; j++) {
          if (j === i || distinctRanks[j] === distinctRanks[j - 1] + 1) {
            // Pick one card of this rank (preferably smallest suit to keep pairs elsewhere)
            const cardOfRank = sortedPool.find(c => c.rank === distinctRanks[j] && !currentStraight.some(cs => cs.id === c.id));
            if (cardOfRank) currentStraight.push(cardOfRank);
          } else {
            break;
          }
        }
        if (currentStraight.length >= 3 && currentStraight.length > longest.length) {
          longest = currentStraight;
        }
      }

      if (longest.length >= 3) {
        groups.push(longest);
        removeFromPool(longest);
        found = true;
      }
    } while (found);
  };

  // 3. Detect Triples (Sám cô)
  const findTriples = () => {
    const rankCounts: Record<number, Card[]> = {};
    pool.forEach(c => {
      if (!rankCounts[c.rank]) rankCounts[c.rank] = [];
      rankCounts[c.rank].push(c);
    });
    Object.values(rankCounts).forEach(group => {
      if (group.length === 3) {
        groups.push(sortCards(group));
        removeFromPool(group);
      }
    });
  };

  // 4. Detect Pairs (Đôi)
  const findPairs = () => {
    const rankCounts: Record<number, Card[]> = {};
    pool.forEach(c => {
      if (!rankCounts[c.rank]) rankCounts[c.rank] = [];
      rankCounts[c.rank].push(c);
    });
    // Sort keys to pick pairs in order
    const ranks = Object.keys(rankCounts).map(Number).sort((a, b) => a - b);
    ranks.forEach(rank => {
      const group = rankCounts[rank];
      if (group.length >= 2) {
        const pair = group.slice(0, 2);
        groups.push(sortCards(pair));
        removeFromPool(pair);
      }
    });
  };

  // Execute in priority order
  findFourOfAKind();
  findStraights();
  findTriples();
  findPairs();

  // 5. Remaining are Singles (Rác)
  if (pool.length > 0) {
    groups.push(sortCards(pool));
  }

  // Flatten the groups for the final arrangement
  return groups.flat();
}
// NEW FEATURE END