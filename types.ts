
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

/**
 * Interface for tracking money transactions during a game session.
 * Used by GameEngine to manage balance updates and history.
 */
export interface MoneyTransaction {
  id: string;
  type: MoneyChangeType;
  payouts: PayoutResult[];
  reason: string;
  timestamp: number;
  sourcePlayerId?: string;
}

export interface MatchEvent {
  type: "HEO_CUT" | "HEO_OVER_CUT" | "HEO_STALE" | "HEO_BURN" | "INSTANT_WIN" | "THREE_SPADE_WIN";
  from?: string;
  to?: string;
  player?: string;
  amount?: number;
  reason?: string;
}

export interface PlayerHistoryEntry {
  id: string;
  name: string;
  rank: number;
  balanceBefore: number;
  balanceAfter: number;
  change: number;
  isBurned: boolean;
  transactions?: {
    reason: string;
    amount: number;
    type: MoneyChangeType;
  }[];
}

export interface GameHistory {
  roundId: string;
  timestamp: number;
  bet: number;
  players: PlayerHistoryEntry[];
  events: MatchEvent[];
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
}

export type TrollType = "stone" | "tomato" | "bomb" | "water" | "egg";

export interface TrollAction {
  id: string;
  type: TrollType;
  fromId: string;
  toId: string;
  timestamp: number;
}
