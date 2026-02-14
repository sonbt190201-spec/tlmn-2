
import { Card, Player, Move, HandType, GameHistory, PlayerHistoryEntry, PayoutResult, GameEventRecord } from './types.js';
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
  private roundEvents: GameEventRecord[] = [];

  private lowestCardIdInFirstGame: string | null = null;
  private mustContainStarter: boolean = false;
  private lastWasInstantWin: boolean = false;

  // Lưu vết chuỗi chặt: { attackerId, victimId, value }
  private chopChain: { attackerId: string, victimId: string, value: number, type: string }[] = [];

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
    this.bet = initialBet || 10000;
    this.currentTurn = 0;
    this.lastMove = null;
    this.gamePhase = "waiting";
    this.isFirstGame = true;
    this.startingPlayerId = null;
  }

  setHistory(history: GameHistory[]) {
    this.history = history || [];
  }

  startNewRound() {
    const hands = dealCards(this.players.map(p => p.id));
    this.gamePhase = "playing";
    this.lastMove = null;
    this.passedPlayers.clear();
    this.finishedPlayers = [];
    this.lastPayouts = [];
    this.chopChain = [];
    this.roundEvents = [];

    this.players.forEach(p => {
      const handData = hands.find(h => h.playerId === p.id);
      p.hand = sortCards(handData?.cards || []);
      p.finishedRank = undefined;
      p.hasPlayedAnyCard = false;
      p.isBurned = false;
    });

    // Check Ăn Trắng
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
    const payouts = MoneyEngine.calculateTrangMoney(winnerId, this.players.map(p => p.id), this.bet);
    this.lastPayouts = payouts;
    payouts.forEach(pay => {
      const p = this.players.find(pl => pl.id === pay.playerId);
      if (p) p.balance += pay.change;
    });

    this.finishedPlayers = [winnerId];
    this.players.forEach(p => { if(p.id !== winnerId) { this.finishedPlayers.push(p.id); p.finishedRank = 4; } });
    this.roundEvents.push({ type: 'INSTANT_WIN', playerName: winnerId, description: `Ăn trắng: ${reason}`, timestamp: Date.now() });
    
    this.gamePhase = "finished";
    this.startingPlayerId = winnerId;
    this.isFirstGame = false;
    this.lastWasInstantWin = true; 
    this.recordHistory();
  }

  playMove(playerId: string, cardIds: string[]): string | null {
    if (this.gamePhase !== "playing") return "Ván bài đã kết thúc";
    const player = this.players.find(p => p.id === playerId);
    if (!player) return "Người chơi không tồn tại";
    
    const cards = player.hand.filter(c => cardIds.includes(c.id));
    if (cards.length !== cardIds.length) return "Bài không hợp lệ";

    const handType = detectHandType(cards);
    if (handType === HandType.INVALID) return "Bộ bài không hợp lệ";

    // 4 đôi thông chặt tự do
    const isFourPairs = handType === HandType.FOUR_CONSECUTIVE_PAIRS;
    const canFreeChop = isFourPairs && this.lastMove && compareHands(cards, this.lastMove.cards) === 1;

    if (this.players[this.currentTurn].id !== playerId && !canFreeChop) {
      return "Chưa tới lượt";
    }

    if (this.passedPlayers.has(playerId) && !canFreeChop) {
      return "Bạn đã bỏ lượt";
    }

    // Logic Chặt
    let isChop = false;
    let isOverChop = false;
    if (this.lastMove) {
      if (compareHands(cards, this.lastMove.cards) !== 1) return "Không thể chặn";
      
      const isAttackerHang = [HandType.THREE_CONSECUTIVE_PAIRS, HandType.FOUR_OF_A_KIND, HandType.FOUR_CONSECUTIVE_PAIRS].includes(handType);
      const isVictimHeo = this.lastMove.cards.some(c => c.rank === 15);
      const isVictimHang = [HandType.THREE_CONSECUTIVE_PAIRS, HandType.FOUR_OF_A_KIND, HandType.FOUR_CONSECUTIVE_PAIRS].includes(this.lastMove.type);

      if (isAttackerHang && (isVictimHeo || isVictimHang)) {
        isChop = this.chopChain.length === 0;
        isOverChop = this.chopChain.length > 0;
        
        // Tính giá trị chặt
        let val = 0;
        if (isVictimHeo) {
          this.lastMove.cards.filter(c => c.rank === 15).forEach(c => {
            val += (c.suit === 'heart' || c.suit === 'diamond') ? this.bet : this.bet * 0.5;
          });
        } else {
          if (this.lastMove.type === HandType.THREE_CONSECUTIVE_PAIRS) val = this.bet * 1.5;
          else if (this.lastMove.type === HandType.FOUR_OF_A_KIND) val = this.bet * 2;
          else if (this.lastMove.type === HandType.FOUR_CONSECUTIVE_PAIRS) val = this.bet * 4;
        }

        this.chopChain.push({ attackerId: playerId, victimId: this.lastMove.playerId, value: val, type: isOverChop ? 'OVER_CHOP' : 'CHOP' });
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

  private resolveChopChain() {
    if (this.chopChain.length === 0) return;
    const last = this.chopChain[this.chopChain.length - 1];
    const total = this.chopChain.reduce((s, c) => s + c.value, 0);
    
    const winner = this.players.find(p => p.id === last.attackerId);
    const victim = this.players.find(p => p.id === last.victimId);

    if (winner && victim) {
      victim.balance -= total;
      winner.balance += total;
      const type = this.chopChain.length > 1 ? 'OVER_CHOP' : 'CHOP';
      this.roundEvents.push({ type, fromPlayerId: victim.id, toPlayerId: winner.id, playerName: winner.name, targetName: victim.name, amount: total, description: `${winner.name} chặt ${victim.name} thu ${total}$`, timestamp: Date.now() });
      this.lastPayouts.push({ playerId: winner.id, change: total, reason: "Thắng chặt" });
      this.lastPayouts.push({ playerId: victim.id, change: -total, reason: "Bị chặt" });
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

    // Kiểm tra reset vòng
    if (this.lastMove) {
      const activePlayers = this.players.filter(p => !this.finishedPlayers.includes(p.id) && !p.isBurned && !this.passedPlayers.has(p.id));
      const isOwnerFinished = this.finishedPlayers.includes(this.lastMove.playerId);
      
      // Nếu chỉ còn chủ vòng hoặc chủ vòng đã về và không còn ai chưa pass
      if ((activePlayers.length === 1 && activePlayers[0].id === this.lastMove.playerId) || (isOwnerFinished && activePlayers.length === 0)) {
        this.resolveChopChain();
        this.lastMove = null;
        this.passedPlayers.clear();
        if (!isOwnerFinished) {
          const ownerIdx = this.players.findIndex(p => p.id === this.lastMove!.playerId);
          if (ownerIdx !== -1) { this.currentTurn = ownerIdx; return; }
        }
      }
    }

    const playerCount = this.players.length;
    let nextIdx = (this.currentTurn + 1) % playerCount;
    let attempts = 0;
    while (attempts < playerCount) {
      const p = this.players[nextIdx];
      const isFinished = this.finishedPlayers.includes(p.id);
      const isBurned = p.isBurned;
      const hasPassed = this.passedPlayers.has(p.id);

      if (!this.lastMove) {
        if (!isFinished && !isBurned) { this.currentTurn = nextIdx; return; }
      } else {
        if (!isFinished && !isBurned && !hasPassed) { this.currentTurn = nextIdx; return; }
      }
      nextIdx = (nextIdx + 1) % playerCount;
      attempts++;
    }
    
    if (this.players.filter(p => !this.finishedPlayers.includes(p.id)).length <= 1) this.endRound();
  }

  onPlayerFinished(player: Player) {
    if (this.finishedPlayers.includes(player.id)) return;
    this.finishedPlayers.push(player.id);
    player.finishedRank = this.finishedPlayers.length;

    if (player.finishedRank === 1) {
      this.players.forEach(p => { if (p.id !== player.id && !p.hasPlayedAnyCard) { p.isBurned = true; this.roundEvents.push({ type: 'CONG', playerName: p.name, description: `${p.name} bị Cóng!`, timestamp: Date.now() }); } });
    }

    const active = this.players.filter(p => p.hand.length > 0 && !p.isBurned);
    if (active.length <= 1) {
      this.players.forEach(p => { if (!this.finishedPlayers.includes(p.id)) { this.finishedPlayers.push(p.id); p.finishedRank = this.finishedPlayers.length; } });
      this.endRound();
    } else {
      this.nextTurn();
    }
  }

  endRound() {
    if (this.gamePhase === "finished") return;
    this.resolveChopChain();
    this.gamePhase = "finished";
    this.isFirstGame = false;
    this.lastWasInstantWin = false;
    this.startingPlayerId = this.finishedPlayers[0] || null;

    const burnedCount = this.players.filter(p => p.isBurned).length;
    const results = burnedCount > 0 ? MoneyEngine.calculateCongMoney(this.players, this.bet, burnedCount) : MoneyEngine.calculateRankMoney(this.players, this.bet);
    
    results.forEach(res => {
      const p = this.players.find(pl => pl.id === res.playerId);
      if (p) { p.balance += res.change; this.lastPayouts.push(res); }
    });

    // Thối bài trả cho hạng 3
    const pRank3 = this.players.find(p => p.finishedRank === 3);
    const pRank4 = this.players.find(p => p.finishedRank === 4);
    if (pRank4 && pRank3) {
      const thoi = MoneyEngine.calculateThoiValue(pRank4, this.bet);
      if (thoi.totalLoss > 0) {
        pRank4.balance -= thoi.totalLoss;
        pRank3.balance += thoi.totalLoss;
        this.roundEvents.push({ type: 'THOI', fromPlayerId: pRank4.id, toPlayerId: pRank3.id, playerName: pRank3.name, targetName: pRank4.name, amount: thoi.totalLoss, description: `${pRank4.name} thối ${thoi.details.join(', ')} trả cho ${pRank3.name}`, timestamp: Date.now() });
        this.lastPayouts.push({ playerId: pRank4.id, change: -thoi.totalLoss, reason: "Thối bài" });
        this.lastPayouts.push({ playerId: pRank3.id, change: thoi.totalLoss, reason: "Nhận tiền thối" });
      }
    }

    this.recordHistory();
  }

  recordHistory() {
    const playersHistory: PlayerHistoryEntry[] = this.players.map(p => {
      const playerPayouts = this.lastPayouts.filter(pay => pay.playerId === p.id);
      const totalChange = playerPayouts.reduce((sum, pay) => sum + pay.change, 0);
      return { id: p.id, name: p.name, rank: p.finishedRank || 0, balanceBefore: p.balance - totalChange, balanceAfter: p.balance, change: totalChange, isBurned: p.isBurned, transactions: playerPayouts.map(pay => ({ reason: pay.reason || "Kết quả", amount: pay.change, type: pay.change >= 0 ? "WIN" : "LOSE" })) };
    });
    this.history.unshift({ roundId: Math.random().toString(36).substr(2, 5).toUpperCase(), timestamp: Date.now(), bet: this.bet, players: playersHistory, events: [...this.roundEvents] });
    if (this.history.length > 50) this.history = this.history.slice(0, 50);
    this.lastPayouts = [];
    this.roundEvents = [];
  }

  getState(viewerId: string) {
    return { players: this.players.map(p => ({ ...p, hand: (this.gamePhase === "finished" || p.id === viewerId) ? p.hand : p.hand.map(() => null) })), currentTurn: this.currentTurn, lastMove: this.lastMove, gamePhase: this.gamePhase, bet: this.bet, passedPlayers: Array.from(this.passedPlayers), history: this.history };
  }

  getInternalState() {
    return { isFirstGame: this.isFirstGame, lastWasInstantWin: this.lastWasInstantWin, startingPlayerId: this.startingPlayerId, history: this.history };
  }

  /**
   * Restore persistent state (used when recreating GameInstance in server.ts)
   */
  setPersistentState(state: any) {
    if (!state) return;
    this.isFirstGame = state.isFirstGame;
    this.lastWasInstantWin = state.lastWasInstantWin;
    this.startingPlayerId = state.startingPlayerId;
    this.history = state.history || [];
  }
}
