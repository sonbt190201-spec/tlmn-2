
import { Card, Player, Move, HandType, GameHistory, PlayerHistoryEntry, PayoutResult, GameEventRecord, MoneyChangeType } from './types.js';
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

  // Cấu trúc lưu vết chặt để tính tiền khi kết thúc vòng
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
    if (Array.isArray(history)) {
      this.history = history;
    }
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

  setPersistentState(state: { isFirstGame: boolean, lastWasInstantWin: boolean, startingPlayerId: string | null }) {
    if (state) {
      this.isFirstGame = state.isFirstGame ?? this.isFirstGame;
      this.lastWasInstantWin = state.lastWasInstantWin ?? this.lastWasInstantWin;
      this.startingPlayerId = state.startingPlayerId ?? this.startingPlayerId;
    }
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
    this.roundEvents = [];

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
    const payouts = MoneyEngine.calculateTrangMoney(winnerId, this.players.map(p => p.id), this.bet);
    this.lastPayouts = payouts;
    
    payouts.forEach(pay => {
      const p = this.players.find(pl => pl.id === pay.playerId);
      if (p) p.balance += pay.change;
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

    this.roundEvents.push({
      type: 'INSTANT_WIN',
      playerName: winner.name,
      description: `Ăn trắng: ${reason}`,
      timestamp: Date.now()
    });

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
    if (cards.length === 0 || cards.length !== cardIds.length) return "Lá bài không hợp lệ trong tay";

    const handType = detectHandType(cards);
    
    // Kiểm tra 4 đôi thông: Có thể chặt tự do (không cần theo vòng, không cần đang lượt)
    const isFourPairs = (handType === HandType.FOUR_CONSECUTIVE_PAIRS);
    const isFreeChop = isFourPairs && this.lastMove !== null && compareHands(cards, this.lastMove.cards) === 1;

    if (this.players[this.currentTurn].id !== playerId && !isFreeChop) {
      return "Chưa tới lượt";
    }

    if (this.passedPlayers.has(playerId) && !isFreeChop) {
      return "Bạn đã bỏ lượt của vòng này";
    }

    if (handType === HandType.INVALID) return "Bộ bài không hợp lệ";

    if (this.mustContainStarter && this.lastMove === null) {
      const containsLowest = cards.some(c => c.id === this.lowestCardIdInFirstGame);
      if (!containsLowest && (this.isFirstGame || this.lastWasInstantWin)) {
         return `Ván đầu/Sau ăn trắng: Phải đánh 3 bích.`;
      }
    }

    let isChopMove = false;
    let isOverChopMove = false;

    if (this.lastMove) {
      if (compareHands(cards, this.lastMove.cards) !== 1) return "Không thể chặn bộ bài này";
      
      const lastType = this.lastMove.type;
      const isVictimHeo = this.lastMove.cards.some(c => c.rank === 15);
      const isVictimSpecial = (lastType === HandType.THREE_CONSECUTIVE_PAIRS || lastType === HandType.FOUR_OF_A_KIND || lastType === HandType.FOUR_CONSECUTIVE_PAIRS);
      const isAttackerSpecial = (handType === HandType.THREE_CONSECUTIVE_PAIRS || handType === HandType.FOUR_OF_A_KIND || handType === HandType.FOUR_CONSECUTIVE_PAIRS);

      // Chỉ coi là "chặt" nếu người đánh dùng "hàng" để chặn "heo" hoặc "hàng" khác
      if (isAttackerSpecial && (isVictimHeo || isVictimSpecial)) {
        isChopMove = this.chopChain.length === 0;
        isOverChopMove = this.chopChain.length > 0;
        
        const chopVal = this.calculateInstantChopValue(this.lastMove.cards, handType);
        this.chopChain.push({ 
          attackerId: playerId, 
          victimId: this.lastMove.playerId, 
          value: chopVal,
          type: isOverChopMove ? 'OVER_CHOP' : 'CHOP'
        });
      }
    }

    player.hand = player.hand.filter(c => !cardIds.includes(c.id));
    player.hasPlayedAnyCard = true;
    
    this.lastMove = { 
        type: handType, 
        cards, 
        playerId, 
        timestamp: Date.now(), 
        isChop: isChopMove, 
        isOverChop: isOverChopMove 
    };
    this.mustContainStarter = false;

    const pIdx = this.players.findIndex(p => p.id === playerId);
    this.currentTurn = pIdx;

    if (player.hand.length === 0) {
      this.onPlayerFinished(player);
    } else {
      this.nextTurn(); 
    }
    return null;
  }

  private calculateInstantChopValue(victimCards: Card[], attackerType: HandType): number {
    let total = 0;
    const victimType = detectHandType(victimCards);

    // Tính tiền theo lá heo lẻ hoặc đôi
    const heoCards = victimCards.filter(c => c.rank === 15);
    if (heoCards.length > 0) {
      heoCards.forEach(c => {
        // Heo đen: 0.5 cược, Heo đỏ: 1 cược
        total += (c.suit === 'heart' || c.suit === 'diamond') ? this.bet : this.bet * 0.5;
      });
    } else {
      // Chặt hàng chồng hàng
      if (victimType === HandType.THREE_CONSECUTIVE_PAIRS) total = this.bet * 1.5;
      else if (victimType === HandType.FOUR_OF_A_KIND) total = this.bet * 2;
      else if (victimType === HandType.FOUR_CONSECUTIVE_PAIRS) total = this.bet * 3;
    }
    
    return total || this.bet;
  }

  private resolveChopChain() {
    if (this.chopChain.length === 0) return;

    // Luật "Chặt chồng": Người bị chặt cuối cùng phải trả toàn bộ số tiền tích lũy cho người chặt cuối cùng
    const lastChop = this.chopChain[this.chopChain.length - 1];
    const ultimateWinnerId = lastChop.attackerId;
    const ultimateVictimId = lastChop.victimId;
    const totalValue = this.chopChain.reduce((sum, item) => sum + item.value, 0);

    const winner = this.players.find(p => p.id === ultimateWinnerId);
    const victim = this.players.find(p => p.id === ultimateVictimId);

    if (winner && victim) {
      victim.balance -= totalValue;
      winner.balance += totalValue;
      
      const event: GameEventRecord = {
        type: this.chopChain.length > 1 ? 'OVER_CHOP' : 'CHOP',
        fromPlayerId: ultimateVictimId,
        toPlayerId: ultimateWinnerId,
        playerName: winner.name,
        targetName: victim.name, // PlayerName dùng làm người chiến thắng, TargetName dùng làm nạn nhân
        amount: totalValue,
        description: `${winner.name} chặt ${victim.name} thu ${totalValue}$`,
        timestamp: Date.now()
      };
      this.roundEvents.push(event);

      this.lastPayouts.push({ playerId: winner.id, change: totalValue, reason: event.type === 'CHOP' ? "Thắng chặt" : "Thắng chặt chồng" });
      this.lastPayouts.push({ playerId: victim.id, change: -totalValue, reason: event.type === 'CHOP' ? "Bị chặt" : "Bị chặt chồng" });
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

    // 1. Kiểm tra reset vòng (trick)
    if (this.lastMove) {
      const activeInTrick = this.players.filter(p => 
        !this.finishedPlayers.includes(p.id) && 
        !p.isBurned && 
        !this.passedPlayers.has(p.id)
      );

      const ownerId = this.lastMove.playerId;
      const isOwnerFinished = this.finishedPlayers.includes(ownerId);
      
      const everyoneElsePassed = activeInTrick.length === 1 && activeInTrick[0].id === ownerId;
      const ownerFinishedAndNoOneLeft = isOwnerFinished && activeInTrick.length === 0;

      // Khi hết vòng, người thắng vòng được quyền đánh tự do (resetTrick)
      if (everyoneElsePassed || ownerFinishedAndNoOneLeft) {
        this.resolveChopChain();
        this.lastMove = null;
        this.passedPlayers.clear();

        if (!isOwnerFinished) {
          const ownerIdx = this.players.findIndex(p => p.id === ownerId);
          if (ownerIdx !== -1) {
            this.currentTurn = ownerIdx;
            return;
          }
        }
      }
    }

    // 2. Tìm người chơi tiếp theo
    const playerCount = this.players.length;
    let nextIdx = (this.currentTurn + 1) % playerCount;
    let attempts = 0;

    while (attempts < playerCount) {
      const nextPlayer = this.players[nextIdx];
      const isFinished = this.finishedPlayers.includes(nextPlayer.id);
      const isBurned = nextPlayer.isBurned;
      const hasPassed = this.passedPlayers.has(nextPlayer.id);

      if (!this.lastMove) {
        if (!isFinished && !isBurned) {
          this.currentTurn = nextIdx;
          return;
        }
      } else {
        if (!isFinished && !isBurned && !hasPassed) {
          this.currentTurn = nextIdx;
          return;
        }
      }

      nextIdx = (nextIdx + 1) % playerCount;
      attempts++;
    }

    if (this.players.filter(p => !this.finishedPlayers.includes(p.id)).length <= 1) {
      this.endRound();
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
          this.roundEvents.push({
            type: 'CONG',
            playerName: p.name,
            description: `${p.name} bị cóng!`,
            timestamp: Date.now()
          });
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
    let rankPayouts: PayoutResult[] = [];

    if (burnedCount > 0) {
      rankPayouts = MoneyEngine.calculateCongMoney(this.players, this.bet, burnedCount);
    } else {
      rankPayouts = MoneyEngine.calculateRankMoney(this.players, this.bet);
    }

    rankPayouts.forEach(pay => {
      const p = this.players.find(pl => pl.id === pay.playerId);
      if (p) {
        p.balance += pay.change;
        this.lastPayouts.push(pay);
        
        if (p.id === this.startingPlayerId) {
          this.roundEvents.push({
            type: 'RANK',
            playerName: p.name,
            description: `${p.name} thắng ván - Nhận ${pay.change}$`,
            amount: pay.change,
            timestamp: Date.now()
          });
        }
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
          
          const event: GameEventRecord = {
            type: 'THOI',
            fromPlayerId: p.id,
            toPlayerId: receiver.id,
            playerName: receiver.name,
            targetName: p.name,
            amount: thui.totalLoss,
            description: `${p.name} thúi bài (${thui.details.join(', ')}) đền ${thui.totalLoss}$ cho ${receiver.name}`,
            timestamp: Date.now()
          };
          this.roundEvents.push(event);

          this.lastPayouts.push({ playerId: p.id, change: -thui.totalLoss, reason: `Thối ${thui.details.join(', ')}` });
          this.lastPayouts.push({ playerId: receiver.id, change: thui.totalLoss, reason: `Ăn thối từ ${p.name}` });
        }
      }
    });

    this.recordHistory();
  }

  recordHistory() {
    const playersHistory: PlayerHistoryEntry[] = this.players.map(p => {
      const playerPayouts = this.lastPayouts.filter(pay => pay.playerId === p.id);
      const totalChange = playerPayouts.reduce((sum, pay) => sum + pay.change, 0);

      return {
        id: p.id,
        name: p.name,
        rank: p.finishedRank || 0,
        balanceBefore: p.balance - totalChange,
        balanceAfter: p.balance,
        change: totalChange, 
        isBurned: p.isBurned,
        transactions: playerPayouts.map(pay => ({
          reason: pay.reason || "Ván đấu",
          amount: pay.change,
          type: pay.change >= 0 ? "WIN" : "LOSE"
        }))
      };
    });

    this.history.unshift({
      roundId: Math.random().toString(36).substr(2, 5).toUpperCase(),
      timestamp: Date.now(),
      bet: this.bet,
      players: playersHistory,
      events: [...this.roundEvents]
    });
    
    if (this.history.length > 100) this.history = this.history.slice(0, 100);

    this.lastPayouts = [];
    this.roundEvents = [];
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
      history: this.history
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
