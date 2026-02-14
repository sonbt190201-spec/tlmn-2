
import { Card, Player, Move, HandType, GameHistory, MoneyTransaction, MoneyChangeType, PlayerHistoryEntry, PayoutResult } from './types.js';
import { detectHandType, compareHands, sortCards, checkInstantWin } from './ruleValidator.js';
import { MoneyEngine } from './moneyEngine.js';
import { dealCards } from './deckManager.js';

const STORAGE_KEY = 'TLMN_ACCOUNTS';

export type GamePhase = "playing" | "finished";

export class GameEngine {
  players: Player[];
  bet: number;
  history: GameHistory[];
  currentTurn: number;
  lastMove: Move | null;
  gamePhase: GamePhase;
  isFirstGame: boolean;
  passedPlayers: Set<string>;
  finishedPlayers: string[]; 
  pendingChopWinner: string | null;
  pendingChopAmount: number;
  lastChopCulprit: string | null;
  startingPlayerId: string | null;
  
  recentTransactions: MoneyTransaction[] = [];

  constructor(playerNames: string[], initialBet: number) {
    const savedAccounts = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    this.players = playerNames.map(name => {
      const balance = savedAccounts[name] !== undefined ? savedAccounts[name] : 1000000;
      return {
        id: name,
        name,
        balance,
        hand: [],
        hasPlayedAnyCard: false,
        isBurned: false,
        penalties: []
      };
    });
    this.bet = initialBet;
    this.history = [];
    this.currentTurn = 0;
    this.lastMove = null;
    this.gamePhase = "finished";
    this.isFirstGame = true;
    this.passedPlayers = new Set();
    this.finishedPlayers = [];
    this.pendingChopAmount = 0;
    this.pendingChopWinner = null;
    this.lastChopCulprit = null;
    this.startingPlayerId = null;
  }

  saveBalances() {
    const savedAccounts = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    this.players.forEach(p => { savedAccounts[p.name] = p.balance; });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedAccounts));
  }

  setBet(amount: number) {
    this.bet = Math.min(100000, Math.max(0, amount));
  }

  applyMoneyTransaction(payouts: PayoutResult[], type: MoneyChangeType, reason: string, sourcePlayerId?: string) {
    const tx: MoneyTransaction = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      payouts,
      reason,
      timestamp: Date.now(),
      sourcePlayerId
    };

    const sum = payouts.reduce((acc, p) => acc + p.change, 0);
    if (Math.abs(sum) > 0.01) {
      console.error("Money Integrity Error: Transaction sum is not zero!", payouts);
    }

    payouts.forEach(pay => {
      const player = this.players.find(p => p.id === pay.playerId);
      if (player) {
        player.balance += pay.change;
      }
    });

    this.recentTransactions.push(tx);
    this.saveBalances();
  }

  forceResetRound() {
    this.gamePhase = "finished";
    this.lastMove = null;
    this.passedPlayers.clear();
    this.finishedPlayers = [];
    this.pendingChopAmount = 0;
    this.pendingChopWinner = null;
    this.lastChopCulprit = null;
    this.recentTransactions = []; 
    
    this.startNewRound();
  }

  startNewRound() {
    const brokePlayers = this.players.filter(p => p.balance < this.bet);
    if (brokePlayers.length > 0) {
      throw new Error(`Người chơi ${brokePlayers.map(p => p.name).join(', ')} không đủ tiền cược!`);
    }

    const hands = dealCards(this.players.map(p => p.id));
    
    this.gamePhase = "playing";
    this.lastMove = null;
    this.passedPlayers.clear();
    this.finishedPlayers = [];
    this.pendingChopAmount = 0;
    this.pendingChopWinner = null;
    this.lastChopCulprit = null;
    this.recentTransactions = []; 
    
    this.players.forEach(p => {
      const handData = hands.find(h => h.playerId === p.id);
      p.hand = sortCards(handData?.cards || []);
      p.finishedRank = undefined;
      p.hasPlayedAnyCard = false;
      p.isBurned = false;
      p.penalties = [];
    });

    for (const p of this.players) {
      const winReason = checkInstantWin(p.hand, this.isFirstGame);
      if (winReason) {
        this.processInstantWin(p.id, winReason);
        return;
      }
    }

    if (this.isFirstGame) {
      this.currentTurn = this.players.findIndex(p => p.hand.some(c => c.rank === 3 && c.suit === "spade"));
    } else if (this.startingPlayerId) {
      this.currentTurn = this.players.findIndex(p => p.id === this.startingPlayerId);
    }
  }

  processInstantWin(winnerId: string, reason: string) {
    this.finishedPlayers = [winnerId];
    this.players.forEach(p => {
      if (p.id !== winnerId) this.finishedPlayers.push(p.id);
    });
    
    const payouts = MoneyEngine.calculateInstantWin(winnerId, this.players.map(p => p.id), this.bet);
    this.applyMoneyTransaction(payouts, "INSTANT_WIN", reason);
    
    this.gamePhase = "finished";
    this.startingPlayerId = winnerId;
    this.isFirstGame = false;
    this.recordHistory();
  }

  recordHistory() {
    const playersHistory: PlayerHistoryEntry[] = this.players.map(p => {
      const playerTxs = this.recentTransactions
        .map(tx => {
          const payout = tx.payouts.find(po => po.playerId === p.id);
          if (!payout) return null;
          
          let displayReason = tx.reason;
          if (tx.type === "BURN" || tx.type === "RANK") {
             displayReason = p.isBurned ? "CHÁY (x2)" : "KẾT QUẢ";
          }

          return {
            reason: displayReason,
            amount: payout.change,
            type: tx.type
          };
        })
        .filter((tx): tx is { reason: string; amount: number; type: MoneyChangeType } => tx !== null);

      const totalChange = playerTxs.reduce((sum, tx) => sum + tx.amount, 0);

      return {
        id: p.id,
        name: p.name,
        rank: p.finishedRank || 0,
        balanceBefore: p.balance - totalChange,
        balanceAfter: p.balance,
        change: totalChange,
        isBurned: p.isBurned,
        transactions: playerTxs
      };
    });

    // Added missing 'events' property to satisfy the GameHistory interface requirement.
    const historyItem: GameHistory = {
      roundId: Math.random().toString(36).substr(2, 5),
      timestamp: Date.now(),
      bet: this.bet,
      players: playersHistory,
      events: []
    };

    this.history.push(historyItem);
  }

  playMove(playerId: string, cardIds: string[]): string | null {
    if (this.gamePhase === "finished") return "Ván bài đã kết thúc";
    
    const player = this.players.find(p => p.id === playerId);
    if (!player) return "Không tìm thấy người chơi";
    if (this.passedPlayers.has(playerId)) return "Bạn đã bỏ lượt";
    
    const cards = player.hand.filter(c => cardIds.includes(c.id));
    const handType = detectHandType(cards);
    if (handType === HandType.INVALID) return "Bộ bài không hợp lệ";

    const isOutOfTurnChop = handType === HandType.FOUR_CONSECUTIVE_PAIRS && 
                            this.lastMove && 
                            compareHands(cards, this.lastMove.cards) === 1;

    if (this.players[this.currentTurn].id !== playerId && !isOutOfTurnChop) return "Chưa tới lượt";
    if (this.lastMove && compareHands(cards, this.lastMove.cards) !== 1) return "Không thể chặn";

    if (this.lastMove && this.isChop(handType, this.lastMove)) {
      this.pendingChopAmount += this.bet; 
      this.pendingChopWinner = playerId;
      this.lastChopCulprit = this.lastMove.playerId;
    }

    player.hand = player.hand.filter(c => !cardIds.includes(c.id));
    player.hasPlayedAnyCard = true;
    this.lastMove = { type: handType, cards, playerId, timestamp: Date.now() };

    if (player.hand.length === 0) {
      this.onPlayerFinished(player);
    } else {
      this.nextTurn();
    }
    return null;
  }

  isChop(newType: HandType, lastMove: Move | null): boolean {
    if (!lastMove) return false;
    
    // PHÂN BIỆT RÕ: Chặt chỉ xảy ra khi dùng Hàng (3 đôi thông, Tứ quý, 4 đôi thông)
    const isAttackerHang = (newType === HandType.THREE_CONSECUTIVE_PAIRS || 
                            newType === HandType.FOUR_OF_A_KIND || 
                            newType === HandType.FOUR_CONSECUTIVE_PAIRS);
    
    const isVictimHeo = lastMove.cards.some(c => c.rank === 15);
    const isVictimHang = (lastMove.type === HandType.THREE_CONSECUTIVE_PAIRS || 
                          lastMove.type === HandType.FOUR_OF_A_KIND || 
                          lastMove.type === HandType.FOUR_CONSECUTIVE_PAIRS);

    // Điều kiện Chặt: PHẢI là dùng Hàng chặn Heo HOẶC chặn Hàng khác
    // Nếu cả 2 đều là SINGLE/PAIR Heo -> isAttackerHang = false -> returns false
    return isAttackerHang && (isVictimHeo || isVictimHang);
  }

  onPlayerFinished(player: Player) {
    this.finishedPlayers.push(player.id);
    player.finishedRank = this.finishedPlayers.length;

    if (player.finishedRank === 1) {
      this.players.forEach(p => {
        if (p.id !== player.id && !p.hasPlayedAnyCard) p.isBurned = true;
      });
    }

    const remainingNonFinished = this.players.filter(p => !this.finishedPlayers.includes(p.id));
    const activeRemaining = remainingNonFinished.filter(p => !p.isBurned);

    if (activeRemaining.length <= 1) {
      activeRemaining.forEach(p => {
        this.finishedPlayers.push(p.id);
        p.finishedRank = this.finishedPlayers.length;
      });
      remainingNonFinished.filter(p => p.isBurned).forEach(p => {
        this.finishedPlayers.push(p.id);
        p.finishedRank = this.finishedPlayers.length;
      });
      
      this.endRound();
    } else {
      this.nextTurn();
    }
  }

  nextTurn() {
    const activeInGame = this.players.filter(p => !this.finishedPlayers.includes(p.id) && !p.isBurned);
    if (activeInGame.length === 0) return;

    let nextIdx = (this.currentTurn + 1) % 4;
    let attempts = 0;
    while (
      this.finishedPlayers.includes(this.players[nextIdx].id) || 
      this.players[nextIdx].isBurned ||
      this.passedPlayers.has(this.players[nextIdx].id)
    ) {
      nextIdx = (nextIdx + 1) % 4;
      attempts++;
      if (attempts >= 8) break; 
    }

    if (this.lastMove && this.players[nextIdx].id === this.lastMove.playerId) {
      this.resetTrick(this.lastMove.playerId);
      return;
    }
    this.currentTurn = nextIdx;
  }

  resetTrick(winnerId: string) {
    if (this.pendingChopWinner && this.lastChopCulprit) {
      const type = this.pendingChopAmount > this.bet ? "OVER_CHOP" : "CHOP";
      this.applyMoneyTransaction([
        { playerId: this.pendingChopWinner, change: this.pendingChopAmount },
        { playerId: this.lastChopCulprit, change: -this.pendingChopAmount }
      ], type, "Thắng chặt", this.lastChopCulprit);
    }
    
    this.lastMove = null;
    this.passedPlayers.clear();
    this.pendingChopAmount = 0;
    this.pendingChopWinner = null;
    this.lastChopCulprit = null;
    
    this.currentTurn = this.players.findIndex(p => p.id === winnerId);
    if (this.finishedPlayers.includes(this.players[this.currentTurn].id)) {
      this.nextTurn();
    }
  }

  passTurn(playerId: string) {
    if (this.players[this.currentTurn].id !== playerId || this.lastMove === null) return;
    this.passedPlayers.add(playerId);
    this.nextTurn();
  }

  endRound() {
    this.gamePhase = "finished";
    this.isFirstGame = false;
    this.startingPlayerId = this.finishedPlayers[0];

    const winnerId = this.finishedPlayers[0];
    const isBurnedMap: Record<string, boolean> = {};
    this.players.forEach(p => isBurnedMap[p.id] = p.isBurned);
    
    const rankPayouts = MoneyEngine.calculateGameEnd(this.players, this.bet, isBurnedMap);
    const hasAnyBurn = Object.values(isBurnedMap).some(v => v);
    this.applyMoneyTransaction(rankPayouts, hasAnyBurn ? "BURN" : "RANK", "KẾT QUẢ");

    const burnedPlayers = this.players.filter(p => p.isBurned);
    const losersForThui = burnedPlayers.length > 0 ? burnedPlayers : [this.players.find(p => p.id === this.finishedPlayers[3])!];
    
    losersForThui.forEach(loser => {
       if (!loser) return;
       const thuiResult = MoneyEngine.calculateThui(loser, this.bet);
       if (thuiResult.totalLoss > 0) {
         this.applyMoneyTransaction([
           { playerId: loser.id, change: -thuiResult.totalLoss },
           { playerId: winnerId, change: thuiResult.totalLoss }
         ], "THUI", `THÚI BÀI (${loser.name})`, loser.id);
       }
    });
    
    this.recordHistory();
  }
}
