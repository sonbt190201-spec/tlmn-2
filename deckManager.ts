
import { Card, CardSuit } from './types.js';

export function createDeck(): Card[] {
  const deck: Card[] = [];
  const suits: CardSuit[] = ["spade", "club", "diamond", "heart"];
  
  for (let rank = 3; rank <= 15; rank++) {
    for (const suit of suits) {
      deck.push({
        rank,
        suit,
        id: `${rank}-${suit}`
      });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealCards(playerIds: string[]): { playerId: string; cards: Card[] }[] {
  if (playerIds.length < 2 || playerIds.length > 4) {
    throw new Error("Tiến Lên yêu cầu từ 2 đến 4 người chơi.");
  }

  const rawDeck = createDeck();
  const shuffledDeck = shuffleDeck(rawDeck);
  
  const dealt: { playerId: string; cards: Card[] }[] = playerIds.map((id, index) => {
    const start = index * 13;
    const end = start + 13;
    return {
      playerId: id,
      cards: shuffledDeck.slice(start, end)
    };
  });

  verifyDeal(dealt, playerIds.length);
  return dealt;
}

function verifyDeal(dealt: { playerId: string; cards: Card[] }[], playerCount: number) {
  const allCards = dealt.flatMap(p => p.cards);
  const cardIds = allCards.map(c => c.id);
  const uniqueIds = new Set(cardIds);

  if (allCards.length !== playerCount * 13) {
    throw new Error(`Lỗi Integrity: Mong đợi ${playerCount * 13} lá, nhưng tìm thấy ${allCards.length}`);
  }

  if (uniqueIds.size !== allCards.length) {
    throw new Error("Bộ bài bị lỗi: Phát hiện lá bài trùng lặp!");
  }

  dealt.forEach(p => {
    if (p.cards.length !== 13) {
      throw new Error(`Lỗi Integrity: Người chơi ${p.playerId} nhận được ${p.cards.length} lá thay vì 13.`);
    }
  });

  console.log(`--- BÁO CÁO CHIA BÀI (${playerCount} người) ---`);
  dealt.forEach(p => console.log(`Player ${p.playerId}: ${p.cards.length} lá`));
}
