
import { Player, PayoutResult, Move, HandType } from './types.js';

export interface ThoiResult {
  totalLoss: number;
  details: string[];
}

export class MoneyEngine {
  /**
   * TÍNH TIỀN PHẠT CHẶT BÀI
   */
  static calculateChopPenalty(victimMove: Move, attackerHandType: HandType, bet: number, isOverChop: boolean): number {
    let penalty = 0;
    const overChopMultiplier = isOverChop ? 2 : 1;

    // 1. Heo bị chặt
    if (victimMove.cards.some(c => c.rank === 15)) {
        const isDoublePig = victimMove.type === HandType.PAIR;
        if (attackerHandType === HandType.THREE_CONSECUTIVE_PAIRS) {
            penalty = isDoublePig ? 0 : bet * 1; // 3 đôi thông không chặt được đôi heo
        } else if (attackerHandType === HandType.FOUR_OF_A_KIND) {
            penalty = bet * (isDoublePig ? 4 : 2);
        } else if (attackerHandType === HandType.FOUR_CONSECUTIVE_PAIRS) {
            penalty = bet * (isDoublePig ? 6 : 3);
        }
    }
    // 2. Hàng bị chặt
    else if (victimMove.type === HandType.THREE_CONSECUTIVE_PAIRS) {
        if (attackerHandType === HandType.FOUR_OF_A_KIND) penalty = bet * 3;
        else if (attackerHandType === HandType.FOUR_CONSECUTIVE_PAIRS) penalty = bet * 4;
    } else if (victimMove.type === HandType.FOUR_OF_A_KIND) {
        if (attackerHandType === HandType.FOUR_CONSECUTIVE_PAIRS) penalty = bet * 5;
    }
    
    return penalty * overChopMultiplier;
  }

  /**
   * TÍNH TIỀN THỐI (Độc lập)
   * Heo đen: 0.5, Heo đỏ: 1, 3 đôi thông: 1, Tứ quý: 4
   */
  static calculateThoi(player: Player, bet: number): ThoiResult {
    let loss = 0;
    const details: string[] = [];
    const hand = player.hand;
    const counts: Record<number, number> = {};

    hand.forEach(c => {
      if (c.rank === 15) {
        if (c.suit === 'heart' || c.suit === 'diamond') {
          loss += bet;
          details.push("Heo đỏ");
        } else {
          loss += bet * 0.5;
          details.push("Heo đen");
        }
      }
      counts[c.rank] = (counts[c.rank] || 0) + 1;
    });

    Object.keys(counts).forEach(rank => {
      const r = Number(rank);
      if (counts[r] === 4 && r < 15) {
        loss += bet * 4;
        details.push("Tứ quý");
      }
    });

    const sortedRanks = Object.keys(counts).map(Number).sort((a, b) => a - b);
    for (let i = 0; i < sortedRanks.length - 2; i++) {
      if (counts[sortedRanks[i]] >= 2 && counts[sortedRanks[i + 1]] >= 2 && counts[sortedRanks[i + 2]] >= 2 &&
          sortedRanks[i + 1] === sortedRanks[i] + 1 && sortedRanks[i + 2] === sortedRanks[i + 1] + 1 &&
          sortedRanks[i + 2] < 15) {
        loss += bet;
        details.push("3 đôi thông");
        break; 
      }
    }

    return { totalLoss: loss, details };
  }

  /**
   * settleGame: Điều phối thanh toán ván đấu
   */
  static settleGame(players: Player[], bet: number): PayoutResult[] {
    const playerCount = players.length;
    const results: PayoutResult[] = [];
    const sorted = [...players].sort((a, b) => (a.finishedRank || 0) - (b.finishedRank || 0));

    switch (playerCount) {
      case 2:
        this.settleTable2(sorted[0], sorted[1], bet, results);
        break;
      case 3:
        this.settleTable3(sorted[0], sorted[1], sorted[2], bet, results);
        break;
      case 4:
        this.settleTable4(sorted[0], sorted[1], sorted[2], sorted[3], bet, results);
        break;
      default:
        players.forEach(p => results.push({ playerId: p.id, change: 0, reason: "Không đủ người" }));
    }

    return results;
  }

  /**
   * BÀN 2 NGƯỜI
   * Nhất +2, Cóng -2. Tiền thối trả cho Nhất.
   */
  private static settleTable2(p1: Player, p2: Player, bet: number, results: PayoutResult[]) {
    const isBurned = p2.isBurned;
    const multiplier = isBurned ? 2 : 1;
    const reasonBet = isBurned ? "Bị Cóng (-2 cược)" : "Nhì (-1 cược)";
    const reasonWin = isBurned ? "Thắng Cóng (+2 cược)" : "Nhất (+1 cược)";

    results.push({ playerId: p1.id, change: bet * multiplier, reason: reasonWin });
    results.push({ playerId: p2.id, change: -bet * multiplier, reason: reasonBet });

    // Tiền thối
    const thoi = this.calculateThoi(p2, bet);
    if (thoi.totalLoss > 0) {
      results.push({ playerId: p1.id, change: thoi.totalLoss, reason: `Nhận thối từ ${p2.name}: ${thoi.details.join(', ')}` });
      results.push({ playerId: p2.id, change: -thoi.totalLoss, reason: `Thối bài: ${thoi.details.join(', ')}` });
    }
  }

  /**
   * BÀN 3 NGƯỜI
   */
  private static settleTable3(p1: Player, p2: Player, p3: Player, bet: number, results: PayoutResult[]) {
    const burnedCount = [p2, p3].filter(p => p.isBurned).length;

    if (burnedCount === 1) {
      // p3 là người bị cóng (do đã được sort theo rank, Cóng luôn ở cuối)
      results.push({ playerId: p1.id, change: bet * 2, reason: "Thắng Cóng (+2 cược)" });
      results.push({ playerId: p2.id, change: 0, reason: "Nhì (Hòa)" });
      results.push({ playerId: p3.id, change: -bet * 2, reason: "Bị Cóng (-2 cược)" });

      const thoi = this.calculateThoi(p3, bet);
      if (thoi.totalLoss > 0) {
        results.push({ playerId: p1.id, change: thoi.totalLoss, reason: `Nhận thối từ ${p3.name}: ${thoi.details.join(', ')}` });
        results.push({ playerId: p3.id, change: -thoi.totalLoss, reason: `Thối bài: ${thoi.details.join(', ')}` });
      }
    } else if (burnedCount === 2) {
      // Cả 2 đều cóng
      results.push({ playerId: p1.id, change: bet * 4, reason: "Thắng 2 Cóng (+4 cược)" });
      results.push({ playerId: p2.id, change: -bet * 2, reason: "Bị Cóng (-2 cược)" });
      results.push({ playerId: p3.id, change: -bet * 2, reason: "Bị Cóng (-2 cược)" });

      [p2, p3].forEach(p => {
        const thoi = this.calculateThoi(p, bet);
        if (thoi.totalLoss > 0) {
          results.push({ playerId: p1.id, change: thoi.totalLoss, reason: `Nhận thối từ ${p.name}: ${thoi.details.join(', ')}` });
          results.push({ playerId: p.id, change: -thoi.totalLoss, reason: `Thối bài: ${thoi.details.join(', ')}` });
        }
      });
    } else {
      // Không ai cóng: Nhất +1, Nhì 0, Bét -1. Thối: Bét -> Nhì
      results.push({ playerId: p1.id, change: bet, reason: "Nhất (+1 cược)" });
      results.push({ playerId: p2.id, change: 0, reason: "Nhì" });
      results.push({ playerId: p3.id, change: -bet, reason: "Bét (-1 cược)" });

      const thoi = this.calculateThoi(p3, bet);
      if (thoi.totalLoss > 0) {
        results.push({ playerId: p2.id, change: thoi.totalLoss, reason: `Nhì nhận thối từ ${p3.name}: ${thoi.details.join(', ')}` });
        results.push({ playerId: p3.id, change: -thoi.totalLoss, reason: `Thối bài: ${thoi.details.join(', ')}` });
      }
    }
  }

  /**
   * BÀN 4 NGƯỜI
   */
  private static settleTable4(p1: Player, p2: Player, p3: Player, p4: Player, bet: number, results: PayoutResult[]) {
    const burnedCount = [p2, p3, p4].filter(p => p.isBurned).length;

    if (burnedCount === 1) {
      // p4 bị cóng. p2 p3 tranh nhì ba (+0.5, -0.5)
      results.push({ playerId: p1.id, change: bet * 2, reason: "Thắng Cóng (+2 cược)" });
      results.push({ playerId: p2.id, change: bet * 0.5, reason: "Nhì (+0.5 cược)" });
      results.push({ playerId: p3.id, change: -bet * 0.5, reason: "Ba (-0.5 cược)" });
      results.push({ playerId: p4.id, change: -bet * 2, reason: "Bị Cóng (-2 cược)" });

      const thoi = this.calculateThoi(p4, bet);
      if (thoi.totalLoss > 0) {
        results.push({ playerId: p1.id, change: thoi.totalLoss, reason: `Nhận thối từ ${p4.name}: ${thoi.details.join(', ')}` });
        results.push({ playerId: p4.id, change: -thoi.totalLoss, reason: `Thối bài: ${thoi.details.join(', ')}` });
      }
    } else if (burnedCount === 2) {
      // p3, p4 bị cóng. p2 là Ba (0 cược)
      results.push({ playerId: p1.id, change: bet * 4, reason: "Thắng 2 Cóng (+4 cược)" });
      results.push({ playerId: p2.id, change: 0, reason: "Ba (Hòa)" });
      results.push({ playerId: p3.id, change: -bet * 2, reason: "Bị Cóng (-2 cược)" });
      results.push({ playerId: p4.id, change: -bet * 2, reason: "Bị Cóng (-2 cược)" });

      [p3, p4].forEach(p => {
        const thoi = this.calculateThoi(p, bet);
        if (thoi.totalLoss > 0) {
          results.push({ playerId: p1.id, change: thoi.totalLoss, reason: `Nhận thối từ ${p.name}: ${thoi.details.join(', ')}` });
          results.push({ playerId: p.id, change: -thoi.totalLoss, reason: `Thối bài: ${thoi.details.join(', ')}` });
        }
      });
    } else if (burnedCount === 3) {
        // Cả 3 người đều cóng
        results.push({ playerId: p1.id, change: bet * 6, reason: "Thắng 3 Cóng (+6 cược)" });
        [p2, p3, p4].forEach(p => {
            results.push({ playerId: p.id, change: -bet * 2, reason: "Bị Cóng (-2 cược)" });
            const thoi = this.calculateThoi(p, bet);
            if (thoi.totalLoss > 0) {
              results.push({ playerId: p1.id, change: thoi.totalLoss, reason: `Nhận thối từ ${p.name}: ${thoi.details.join(', ')}` });
              results.push({ playerId: p.id, change: -thoi.totalLoss, reason: `Thối bài: ${thoi.details.join(', ')}` });
            }
        });
    } else {
      // Không ai cóng: 1, 0.5, -0.5, -1
      results.push({ playerId: p1.id, change: bet, reason: "Nhất (+1 cược)" });
      results.push({ playerId: p2.id, change: bet * 0.5, reason: "Nhì (+0.5 cược)" });
      results.push({ playerId: p3.id, change: -bet * 0.5, reason: "Ba (-0.5 cược)" });
      results.push({ playerId: p4.id, change: -bet, reason: "Bét (-1 cược)" });

      const thoi = this.calculateThoi(p4, bet);
      if (thoi.totalLoss > 0) {
        results.push({ playerId: p3.id, change: thoi.totalLoss, reason: `Ba nhận thối từ ${p4.name}: ${thoi.details.join(', ')}` });
        results.push({ playerId: p4.id, change: -thoi.totalLoss, reason: `Thối bài: ${thoi.details.join(', ')}` });
      }
    }
  }

  static calculateTrangMoney(w: string, ids: string[], b: number) {
    const res: PayoutResult[] = [];
    const winAmt = b * 2 * (ids.length - 1);
    ids.forEach(id => {
      res.push({
        playerId: id,
        change: id === w ? winAmt : -b * 2,
        reason: id === w ? "Ăn trắng" : "Bị ăn trắng (-2 cược)"
      });
    });
    return res;
  }
  static calculateThoiValue(p: Player, b: number) { return this.calculateThoi(p, b); }
  static calculateRankMoney(p: Player[], b: number) { return this.settleGame(p, b); }
  static calculateCongMoney(p: Player[], b: number) { return this.settleGame(p, b); }
}
