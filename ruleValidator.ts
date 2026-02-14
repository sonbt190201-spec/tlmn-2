
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

  // Sảnh từ 5 lá trở lên (không được chứa 2)
  if (n >= 5 && !hasTwo && distinctRanks.length === n && isConsecutive(ranks)) {
    return HandType.STRAIGHT;
  }

  // Đôi thông (3 đôi, 4 đôi)
  if (n >= 6 && n % 2 === 0) {
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

  return HandType.INVALID;
}

export function compareHands(newCards: Card[], lastCards: Card[]): number {
  const typeNew = detectHandType(newCards);
  const typeLast = detectHandType(lastCards);

  if (typeNew === HandType.INVALID || typeLast === HandType.INVALID) return 0;

  // 1. Cùng loại, cùng số lượng lá
  if (typeNew === typeLast && newCards.length === lastCards.length) {
    const weightNew = getCardWeight(newCards[newCards.length - 1]);
    const weightLast = getCardWeight(lastCards[lastCards.length - 1]);
    return weightNew > weightLast ? 1 : -1;
  }

  // 2. Luật Chặt Heo/Hàng
  // Chặt Heo đơn bằng 3 đôi thông, tứ quý, 4 đôi thông
  if (typeLast === HandType.SINGLE && lastCards[0].rank === 15) {
    if ([HandType.THREE_CONSECUTIVE_PAIRS, HandType.FOUR_OF_A_KIND, HandType.FOUR_CONSECUTIVE_PAIRS].includes(typeNew)) return 1;
  }

  // Chặt Đôi Heo bằng tứ quý, 4 đôi thông
  if (typeLast === HandType.PAIR && lastCards[0].rank === 15) {
    if ([HandType.FOUR_OF_A_KIND, HandType.FOUR_CONSECUTIVE_PAIRS].includes(typeNew)) return 1;
  }

  // Tứ quý chặt 3 đôi thông
  if (typeLast === HandType.THREE_CONSECUTIVE_PAIRS && typeNew === HandType.FOUR_OF_A_KIND) return 1;

  // 4 đôi thông chặt 3 đôi thông, tứ quý, hoặc 4 đôi thông nhỏ hơn
  if (typeNew === HandType.FOUR_CONSECUTIVE_PAIRS) {
    if (typeLast === HandType.THREE_CONSECUTIVE_PAIRS || typeLast === HandType.FOUR_OF_A_KIND) return 1;
  }

  return 0;
}

export const checkInstantWin = (hand: Card[], isFirstGame: boolean): string | null => {
  const sorted = sortCards(hand);
  const ranks = sorted.map(c => c.rank);
  const counts: Record<number, number> = {};
  ranks.forEach(r => counts[r] = (counts[r] || 0) + 1);

  if (counts[15] === 4) return "Tứ quý heo";
  
  const hasThreeToAce = [3,4,5,6,7,8,9,10,11,12,13,14].every(r => counts[r] >= 1);
  if (hasThreeToAce && counts[15] >= 1) return "Sảnh rồng (3-A + Heo)";

  let maxConsecutivePairs = 0;
  const distinctRanks = Object.keys(counts).map(Number).sort((a,b) => a-b);
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

  let pairs = 0;
  Object.values(counts).forEach(v => pairs += Math.floor(v / 2));
  if (pairs >= 6) return "6 đôi bất kỳ";

  return null;
};
