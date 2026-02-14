
import { Card, HandType, CardSuit } from './types.js';

const SUIT_ORDER: Record<CardSuit, number> = {
  "spade": 0,
  "club": 1,
  "diamond": 2,
  "heart": 3
};

export const getCardWeight = (card: Card): number => {
  return card.rank * 10 + SUIT_ORDER[card.suit];
};

export const sortCards = (cards: Card[]): Card[] => {
  return [...cards].sort((a, b) => getCardWeight(a) - getCardWeight(b));
};

const isConsecutive = (ranks: number[]): boolean => {
  if (ranks.length < 2) return true;
  for (let i = 0; i < ranks.length - 1; i++) {
    if (ranks[i + 1] !== ranks[i] + 1) return false;
  }
  return true;
};

export function detectHandType(cards: Card[]): HandType {
  const n = cards.length;
  if (n === 0) return HandType.INVALID;
  
  const sorted = sortCards(cards);
  const ranks = sorted.map(c => c.rank);
  const distinctRanks = Array.from(new Set(ranks));
  const hasTwo = ranks.includes(15);

  if (n === 1) return HandType.SINGLE;

  if (n === 2) {
    if (ranks[0] === ranks[1]) return HandType.PAIR;
    return HandType.INVALID;
  }

  if (n === 3) {
    if (distinctRanks.length === 1) return HandType.TRIPLE;
    if (!hasTwo && isConsecutive(ranks)) return HandType.STRAIGHT;
    return HandType.INVALID;
  }

  if (n === 4) {
    if (distinctRanks.length === 1) return HandType.FOUR_OF_A_KIND;
    if (!hasTwo && isConsecutive(ranks)) return HandType.STRAIGHT;
    return HandType.INVALID;
  }

  if (n >= 5) {
    if (!hasTwo && distinctRanks.length === n && isConsecutive(ranks)) {
      return HandType.STRAIGHT;
    }

    if (n === 6 || n === 8 || n === 10) {
      let allPairs = true;
      const pairRanks: number[] = [];
      for (let i = 0; i < n; i += 2) {
        if (ranks[i] !== ranks[i + 1]) {
          allPairs = false;
          break;
        }
        pairRanks.push(ranks[i]);
      }

      if (allPairs && !pairRanks.includes(15) && isConsecutive(pairRanks)) {
        if (n === 6) return HandType.THREE_CONSECUTIVE_PAIRS;
        if (n === 8) return HandType.FOUR_CONSECUTIVE_PAIRS;
      }
    }
  }

  return HandType.INVALID;
}

export function compareHands(a: Card[], b: Card[]): number {
  const typeA = detectHandType(a);
  const typeB = detectHandType(b);

  if (typeA === HandType.INVALID || typeB === HandType.INVALID) return 0;

  if (typeA === typeB && a.length === b.length) {
    const weightA = getCardWeight(a[a.length - 1]);
    const weightB = getCardWeight(b[b.length - 1]);
    return weightA > weightB ? 1 : -1;
  }

  // Chặt heo (Rank 15)
  if (typeB === HandType.SINGLE && b[0].rank === 15) {
    if (typeA === HandType.THREE_CONSECUTIVE_PAIRS || typeA === HandType.FOUR_OF_A_KIND || typeA === HandType.FOUR_CONSECUTIVE_PAIRS) return 1;
  }

  if (typeB === HandType.PAIR && b[0].rank === 15) {
    if (typeA === HandType.FOUR_OF_A_KIND || typeA === HandType.FOUR_CONSECUTIVE_PAIRS) return 1;
  }

  // Chặt hàng
  if (typeB === HandType.THREE_CONSECUTIVE_PAIRS) {
    if (typeA === HandType.FOUR_OF_A_KIND || typeA === HandType.FOUR_CONSECUTIVE_PAIRS) return 1;
  }

  if (typeB === HandType.FOUR_OF_A_KIND) {
    if (typeA === HandType.FOUR_CONSECUTIVE_PAIRS) return 1;
  }

  return 0;
}

export const checkInstantWin = (hand: Card[], isFirstGame: boolean): string | null => {
  const sorted = sortCards(hand);
  const ranks = sorted.map(c => c.rank);
  const counts: Record<number, number> = {};
  ranks.forEach(r => counts[r] = (counts[r] || 0) + 1);

  // 1. Tứ quý heo (4 con heo)
  if (counts[15] === 4) return "Tứ quý heo";
  
  // 2. Sảnh từ 3 tới xì (rank 14) + 1 heo (rank 15) bất kỳ
  const distinctRanks = Object.keys(counts).map(Number).sort((a,b) => a-b);
  const hasThreeToAce = [3,4,5,6,7,8,9,10,11,12,13,14].every(r => counts[r] >= 1);
  if (hasThreeToAce && counts[15] >= 1) return "Sảnh rồng (3 tới Xì + Heo)";

  // 3. 5 đôi thông
  let maxConsecutivePairs = 0;
  for (let i = 0; i < distinctRanks.length; i++) {
    if (counts[distinctRanks[i]] >= 2) {
      let count = 1;
      for (let j = i + 1; j < distinctRanks.length; j++) {
        if (distinctRanks[j] === distinctRanks[j-1] + 1 && counts[distinctRanks[j]] >= 2) {
          count++;
        } else break;
      }
      maxConsecutivePairs = Math.max(maxConsecutivePairs, count);
    }
  }
  if (maxConsecutivePairs >= 5) return "5 đôi thông";

  // 4. 6 đôi bất kỳ
  let pairs = 0;
  Object.values(counts).forEach(v => pairs += Math.floor(v / 2));
  if (pairs >= 6) return "6 đôi bất kỳ";

  return null;
};
