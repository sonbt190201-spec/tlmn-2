
export type CardSuit = "spade" | "club" | "diamond" | "heart";

export interface Card {
  rank: number; // 3 -> 15 (3, 4, ..., 11=J, 12=Q, 13=K, 14=A, 15=2)
  suit: CardSuit;
  id: string; // Unique identifier for UI
}

export enum HandType {
  INVALID = "INVALID",
  SINGLE = "SINGLE",
  PAIR = "PAIR",
  TRIPLE = "TRIPLE",
  STRAIGHT = "STRAIGHT",
  THREE_CONSECUTIVE_PAIRS = "THREE_CONSECUTIVE_PAIRS",
  FOUR_CONSECUTIVE_PAIRS = "FOUR_CONSECUTIVE_PAIRS",
  FOUR_OF_A_KIND = "FOUR_OF_A_KIND"
}

export interface Move {
  type: HandType;
  cards: Card[];
  playerId: string;
  timestamp: number;
  isChop?: boolean;
  isOverChop?: boolean;
}

export interface Player {
  id: string;
  name: string;
  balance: number;
  hand: Card[];
  finishedRank?: number; // 1, 2, 3, 4
  hasPlayedAnyCard: boolean;
  isBurned: boolean;
  penalties: string[];
}

export type MoneyChangeType = "RANK" | "CHOP" | "OVER_CHOP" | "THUI" | "BURN" | "INSTANT_WIN" | "THREE_SPADE_WIN";

export interface PayoutResult {
  playerId: string;
  change: number;
  reason?: string;
}

export interface MoneyTransaction {
  id: string;
  type: MoneyChangeType;
  payouts: PayoutResult[];
  reason: string;
  timestamp: number;
  sourcePlayerId?: string;
  targetPlayerId?: string;
}

export interface GameEventRecord {
  type: 'CHOP' | 'OVER_CHOP' | 'THOI' | 'CONG' | 'CONG_CA_BAN' | 'INSTANT_WIN' | 'RANK' | 'THREE_SPADE_WIN';
  fromPlayerId?: string;
  toPlayerId?: string;
  playerName?: string;
  targetName?: string;
  amount?: number;
  description: string;
  timestamp: number;
}

export interface GlobalPlayerStats {
  totalRounds: number;
  totalWin: number;
  totalLose: number;
  totalMoneyWin: number;
  totalMoneyLose: number;
  totalHeoCut: number;
  totalHeoBurn: number;
  totalCongCount: number;
}

export interface PlayerHistoryEntry {
  id: string;
  name: string;
  rank: number;
  balanceBefore: number;
  balanceAfter: number;
  change: number;
  isBurned: boolean;
  transactions: {
    reason: string;
    amount: number;
    type: string;
  }[];
}

export interface GameHistory {
  roundId: string;
  timestamp: number;
  bet: number;
  players: PlayerHistoryEntry[];
  events: GameEventRecord[];
}

// Added missing types for Chat and Troll features
export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
}

export type TrollType = 'stone' | 'tomato' | 'bomb' | 'water' | 'egg';

export interface TrollAction {
  id: string;
  type: TrollType;
  fromId: string;
  toId: string;
  timestamp: number;
}
