
import { Card, Player, Move, HandType, GameHistory, PlayerHistoryEntry, PayoutResult, MatchEvent } from './types.js';
import { detectHandType, compareHands, sortCards, checkInstantWin } from './ruleValidator.js';
import { dealCards } from './deckManager.js';
import { MoneyEngine } from './moneyEngine.js';

export type GamePhase = "waiting" | "playing" | "finished";

export class GameInstance {
  players: Player[];
  bet: number;
  currentTurn: number;
  lastMove: Move | null;
  gamePhase: GamePhase;
  isFirstGame: boolean;
  passedPlayers: Set<string> = new Set();
  finishedPlayers: string[] = []; 
  startingPlayerId: string | null;
  history: GameHistory[] = [];
  private lastPayouts: PayoutResult[] = [];
  private matchEvents: MatchEvent[] = []; 

  private lowestCardIdInFirstGame: string | null = null;
  private mustContainStarter: boolean = false;
  private lastWasInstantWin: boolean = false;

  private chopChain: { attackerId: string, victimId: string, value: number }[] = [];

  constructor(playerData: { id: string, name: string, balance: number }[], initialBet: number) {
    this.players = playerData.map(p => ({
      id: p.id,
      name: p.name,
      balance: p.balance,
      hand: [],
      hasPlayedAnyCard: false,
      isBurned: false,
      penalties: []
    }));
    this.bet = initialBet;
    this.currentTurn = 0;
    this.lastMove = null;
    this.gamePhase = "waiting";
    this.isFirstGame = true;
    this.startingPlayerId = null;
  }

  removePlayer(playerId: string) {
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx === -1) return;
    const wasCurrentTurn = this.currentTurn === idx;
    if (this.currentTurn > idx) this.currentTurn--;
    this.players.splice(idx, 1);
    this.passedPlayers.delete(playerId);
    this.finishedPlayers = this.finishedPlayers.filter(id => id !== playerId);
    if (this.gamePhase === "playing") {
      if (this.players.length <= 1) this.endRound();
      else if (wasCurrentTurn) {
        if (this.currentTurn >= this.players.length) this.currentTurn = 0;
        this.nextTurn();
      }
    }
  }

  setPersistentState(state: { isFirstGame: boolean, lastWasInstantWin: boolean, startingPlayerId: string | null, history?: GameHistory[] }) {
    this.isFirstGame = state.isFirstGame;
    this.lastWasInstantWin = state.lastWasInstantWin;
    this.startingPlayerId = state.startingPlayerId;
    if (state.history) this.history = state.history;
  }

  startNewRound() {
    if (this.players.length < 2) throw new Error("Cần ít nhất 2 người chơi");
    const hands = dealCards(this.players.map(p => p.id));
    this.gamePhase = "playing";
    this.lastMove = null;
    this.passedPlayers.clear();
    this.finishedPlayers = [];
    this.lastPayouts = [];
    this.chopChain = [];
    this.matchEvents = [];

    this.players.forEach(p => {
      const handData = hands.find(h => h.playerId === p.id);
      p.hand = sortCards(handData?.cards || []);
      p.finishedRank = undefined;
      p.hasPlayedAnyCard = false;
      p.isBurned = false;
    });

    for (const p of this.players) {
      const winReason = checkInstantWin(p.hand, this.isFirstGame);
      if (winReason) {
        this.handleInstantWin(p.id, winReason);
        return;
      }
    }

    if (this.isFirstGame || this.lastWasInstantWin) {
      this.mustContainStarter = true;
      let starterIdx = this.players.findIndex(p => p.hand.some(c => c.rank === 3 && c.suit === 'spade'));
      if (starterIdx === -1) starterIdx = 0; 
      this.currentTurn = starterIdx;
      this.lowestCardIdInFirstGame = '3-spade';
    } else if (this.startingPlayerId) {
      const idx = this.players.findIndex(p => p.id === this.startingPlayerId);
      this.currentTurn = idx !== -1 ? idx : 0;
    } else {
      this.currentTurn = 0;
    }
  }

  private handleInstantWin(winnerId: string, reason: string) {
    try {
      const payouts = MoneyEngine.calculateTrangMoney(winnerId, this.players.map(p => p.id), this.bet);
      payouts.forEach(pay => {
        const p = this.players.find(pl => pl.id === pay.playerId);
        if (p) {
          p.balance += pay.change;
          this.lastPayouts.push(pay);
        }
      });
      const winner = this.players.find(p => p.id === winnerId)!;
      winner.finishedRank = 1;
      this.finishedPlayers = [winnerId];
      this.players.forEach(p => { 
        if(p.id !== winnerId) {
          this.finishedPlayers.push(p.id);
          p.finishedRank = 4;
        }
      });
      this.gamePhase = "finished";
      this.startingPlayerId = winnerId;
      this.isFirstGame = false;
      this.lastWasInstantWin = true; 
      this.matchEvents.push({ type: "INSTANT_WIN", player: winner.name, reason });
    } finally {
      this.recordHistory();
    }
  }

  playMove(playerId: string, cardIds: string[]): string | null {
    if (this.gamePhase !== "playing") return "Ván bài đã kết thúc";
    const player = this.players.find(p => p.id === playerId);
    if (!player) return "Người chơi không tồn tại";
    
    const cards = player.hand.filter(c => cardIds.includes(c.id));
    const handType = detectHandType(cards);
    const isFreeChop = (handType === HandType.FOUR_CONSECUTIVE_PAIRS);

    if (this.players[this.currentTurn].id !== playerId && !isFreeChop) return "Chưa tới lượt";
    if (this.passedPlayers.has(playerId) && !isFreeChop) return "Bạn đã bỏ lượt của vòng này";
    if (handType === HandType.INVALID) return "Bộ bài không hợp lệ";

    if (this.mustContainStarter && this.lastMove === null) {
      const containsLowest = cards.some(c => c.id === this.lowestCardIdInFirstGame);
      if (!containsLowest && (this.isFirstGame || this.lastWasInstantWin)) {
         return `Ván đầu: Phải đánh 3 bích.`;
      }
    }

    let isChop = false;
    let isOverChop = false;

    if (this.lastMove) {
      if (compareHands(cards, this.lastMove.cards) !== 1) return "Không thể chặn";
      
      const lastType = this.lastMove.type;
      const isVictimHeo = this.lastMove.cards.some(c => c.rank === 15);
      const isVictimHang = (lastType === HandType.THREE_CONSECUTIVE_PAIRS || lastType === HandType.FOUR_OF_A_KIND || lastType === HandType.FOUR_CONSECUTIVE_PAIRS);
      const isAttackerHang = (handType === HandType.THREE_CONSECUTIVE_PAIRS || handType === HandType.FOUR_OF_A_KIND || handType === HandType.FOUR_CONSECUTIVE_PAIRS);

      if (isAttackerHang && (isVictimHeo || isVictimHang)) {
        isChop = this.chopChain.length === 0;
        isOverChop = this.chopChain.length > 0;
        
        const chopVal = this.calculateInstantChopValue(this.lastMove.cards, handType);
        this.chopChain.push({ attackerId: playerId, victimId: this.lastMove.playerId, value: chopVal });
      }
    }

    player.hand = player.hand.filter(c => !cardIds.includes(c.id));
    player.hasPlayedAnyCard = true;
    this.lastMove = { type: handType, cards, playerId, timestamp: Date.now(), isChop, isOverChop };
    this.mustContainStarter = false;

    if (player.hand.length === 0) {
      this.onPlayerFinished(player);
    } else {
      const pIdx = this.players.findIndex(p => p.id === playerId);
      this.currentTurn = pIdx;
      this.nextTurn(); 
    }
    return null;
  }

  private calculateInstantChopValue(victimCards: Card[], attackerType: HandType): number {
    let total = 0;
    victimCards.forEach(c => {
      if (c.rank === 15) {
        total += (c.suit === 'heart' || c.suit === 'diamond') ? this.bet : this.bet * 0.5;
      }
    });

    if (total === 0) {
      const victimType = detectHandType(victimCards);
      if (victimType === HandType.THREE_CONSECUTIVE_PAIRS) total = this.bet * 1.5;
      else if (victimType === HandType.FOUR_OF_A_KIND) total = this.bet * 2;
      else if (victimType === HandType.FOUR_CONSECUTIVE_PAIRS) total = this.bet * 3;
    }
    
    return total || this.bet;
  }

  private resolveChopChain() {
    if (this.chopChain.length === 0) return;

    const lastChop = this.chopChain[this.chopChain.length - 1];
    const ultimateWinnerId = lastChop.attackerId;
    const ultimateVictimId = lastChop.victimId;
    const totalValue = this.chopChain.reduce((sum, item) => sum + item.value, 0);

    const winner = this.players.find(p => p.id === ultimateWinnerId);
    const victim = this.players.find(p => p.id === ultimateVictimId);

    if (winner && victim) {
      victim.balance -= totalValue;
      winner.balance += totalValue;
      
      const isOver = this.chopChain.length > 1;
      const reason = isOver ? "Chặt chồng" : "Chặt heo/hàng";
      this.lastPayouts.push({ playerId: winner.id, change: totalValue, reason: `Thắng ${reason}` });
      this.lastPayouts.push({ playerId: victim.id, change: -totalValue, reason: `Bị ${reason}` });
      
      this.matchEvents.push({
        type: isOver ? "HEO_OVER_CUT" : "HEO_CUT",
        from: victim.name,
        to: winner.name,
        amount: totalValue
      });
    }
    this.chopChain = [];
  }

  passTurn(playerId: string) {
    if (this.players[this.currentTurn].id !== playerId || !this.lastMove) return;
    this.passedPlayers.add(playerId);
    this.nextTurn();
  }

  nextTurn() {
    if (this.gamePhase !== "playing") return;
    const playerCount = this.players.length;
    let nextIdx = (this.currentTurn + 1) % playerCount;
    let attempts = 0;

    while (attempts < playerCount * 2) {
      const nextPlayer = this.players[nextIdx];

      if (this.lastMove && nextPlayer.id === this.lastMove.playerId) {
        this.resolveChopChain();
        this.lastMove = null;
        this.passedPlayers.clear();

        if (!this.finishedPlayers.includes(nextPlayer.id)) {
          this.currentTurn = nextIdx;
          return;
        } else {
          let searchIdx = (nextIdx + 1) % playerCount;
          let sAttempts = 0;
          while (sAttempts < playerCount) {
            if (!this.finishedPlayers.includes(this.players[searchIdx].id) && !this.players[searchIdx].isBurned) {
              this.currentTurn = searchIdx;
              return;
            }
            searchIdx = (searchIdx + 1) % playerCount;
            sAttempts++;
          }
        }
      }

      if (!this.finishedPlayers.includes(nextPlayer.id) && !this.passedPlayers.has(nextPlayer.id) && !nextPlayer.isBurned) {
        this.currentTurn = nextIdx;
        return;
      }
      nextIdx = (nextIdx + 1) % playerCount;
      attempts++;
    }
  }

  onPlayerFinished(player: Player) {
    if (this.finishedPlayers.includes(player.id)) return;
    this.finishedPlayers.push(player.id);
    player.finishedRank = this.finishedPlayers.length;

    if (player.finishedRank === 1) {
      this.players.forEach(p => {
        if (p.id !== player.id && !p.hasPlayedAnyCard) {
          p.isBurned = true;
          this.matchEvents.push({ type: "HEO_BURN", player: p.name });
        }
      });
    }

    const activePlayers = this.players.filter(p => p.hand.length > 0 && !p.isBurned);
    if (activePlayers.length <= 1) {
      this.players.forEach(p => {
        if (!this.finishedPlayers.includes(p.id)) {
          this.finishedPlayers.push(p.id);
          p.finishedRank = this.finishedPlayers.length;
        }
      });
      this.endRound();
    } else {
      const pIdx = this.players.findIndex(p => p.id === player.id);
      this.currentTurn = pIdx;
      this.nextTurn();
    }
  }

  endRound() {
    if (this.gamePhase === "finished") return;
    try {
      this.gamePhase = "finished";
      this.isFirstGame = false;
      this.lastWasInstantWin = false;
      this.startingPlayerId = this.finishedPlayers[0] || null;

      // Xử lý nốt các pha chặt chưa thanh toán
      this.resolveChopChain();

      const burnedCount = this.players.filter(p => p.isBurned).length;
      let payouts: PayoutResult[] = [];

      if (burnedCount > 0) {
        payouts = MoneyEngine.calculateCongMoney(this.players, this.bet, burnedCount);
      } else {
        payouts = MoneyEngine.calculateRankMoney(this.players, this.bet);
      }

      payouts.forEach(pay => {
        const p = this.players.find(pl => pl.id === pay.playerId);
        if (p) {
          p.balance += pay.change;
          this.lastPayouts.push(pay);
        }
      });

      const winner = this.players.find(p => p.id === this.startingPlayerId);
      const pRank3 = this.players.find(p => p.finishedRank === 3);

      this.players.forEach(p => {
        if (p.id === this.startingPlayerId) return;
        
        const thui = MoneyEngine.calculateThoiMoney(p, this.bet);
        if (thui.totalLoss > 0) {
          let receiver = winner; 
          if (burnedCount === 0 && p.finishedRank === 4 && pRank3) {
            receiver = pRank3;
          }

          if (receiver) {
            p.balance -= thui.totalLoss;
            receiver.balance += thui.totalLoss;
            const details = thui.details.join(', ');
            this.lastPayouts.push({ playerId: p.id, change: -thui.totalLoss, reason: `Thối ${details}` });
            this.lastPayouts.push({ playerId: receiver.id, change: thui.totalLoss, reason: `Ăn thối từ ${p.name}` });
            
            this.matchEvents.push({
              type: "HEO_STALE",
              player: p.name,
              to: receiver.name,
              amount: thui.totalLoss,
              reason: details
            });
          }
        }
      });
    } finally {
      this.recordHistory();
    }
  }

  recordHistory() {
    const playersHistory: PlayerHistoryEntry[] = this.players.map(p => {
      const totalChange = this.lastPayouts
        .filter(pay => pay.playerId === p.id)
        .reduce((sum, pay) => sum + pay.change, 0);

      return {
        id: p.id,
        name: p.name,
        rank: p.finishedRank || 0,
        balanceBefore: p.balance - totalChange,
        balanceAfter: p.balance,
        change: totalChange, 
        isBurned: p.isBurned
      };
    });

    this.history.unshift({
      roundId: Math.random().toString(36).substr(2, 5),
      timestamp: Date.now(),
      bet: this.bet,
      players: playersHistory,
      events: [...this.matchEvents] 
    });
  }

  getState(viewerId: string) {
    return {
      players: this.players.map(p => ({
        ...p,
        hand: (this.gamePhase === "finished" || p.id === viewerId) ? p.hand : p.hand.map(() => null) 
      })),
      currentTurn: this.currentTurn,
      lastMove: this.lastMove,
      gamePhase: this.gamePhase,
      bet: this.bet,
      passedPlayers: Array.from(this.passedPlayers),
      history: this.history,
      lastPayouts: this.lastPayouts
    };
  }

  getInternalState() {
    return {
      isFirstGame: this.isFirstGame,
      lastWasInstantWin: this.lastWasInstantWin,
      startingPlayerId: this.startingPlayerId,
      history: this.history
    };
  }
}
