
import { Player, PayoutResult } from './types.js';

export interface ThoiResult {
  totalLoss: number;
  details: string[];
}

export class MoneyEngine {
  /**
   * VI. QUY TẮC THỐI (Độc lập)
   * Heo đen: 0.5, Heo đỏ: 1, 3 đôi thông: 1, Tứ quý: 4
   */
  static calculateThoi(player: Player, bet: number): ThoiResult {
    let loss = 0;
    const details: string[] = [];
    const hand = player.hand;
    const counts: Record<number, number> = {};

    hand.forEach(c => {
      // Heo (rank 15)
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

    // Tứ quý (4 lá cùng rank < 15)
    Object.keys(counts).forEach(rank => {
      const r = Number(rank);
      if (counts[r] === 4 && r < 15) {
        loss += bet * 4;
        details.push("Tứ quý");
      }
    });

    // 3 đôi thông (3 cặp liên tiếp < 15)
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
   * settleGame: Hàm điều phối chính dựa trên playerCount
   */
  static settleGame(players: Player[], bet: number): PayoutResult[] {
    const playerCount = players.length;
    const results: PayoutResult[] = [];
    // Sắp xếp người chơi theo rank thực tế (1 -> 4)
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
   * III. BÀN 2 NGƯỜI
   * Tiền thứ hạng: Nhất +1, Bét -1
   * Tiền thối: Bét -> Nhất
   */
  private static settleTable2(p1: Player, last: Player, bet: number, results: PayoutResult[]) {
    // 1. Tiền thứ hạng
    results.push({ playerId: p1.id, change: bet, reason: "Nhất (+1 cược)" });
    results.push({ playerId: last.id, change: -bet, reason: "Bét (-1 cược)" });

    // 2. Tiền thối
    const thoi = this.calculateThoi(last, bet);
    if (thoi.totalLoss > 0) {
      results.push({ playerId: p1.id, change: thoi.totalLoss, reason: `Nhận thối: ${thoi.details.join(', ')}` });
      results.push({ playerId: last.id, change: -thoi.totalLoss, reason: `Thối bài: ${thoi.details.join(', ')}` });
    }
  }

  /**
   * IV. BÀN 3 NGƯỜI
   * Tiền thứ hạng: Nhất +1, Nhì 0, Bét -1 (Bét trả cho Nhất)
   * Tiền thối: Bét -> Nhì
   */
  private static settleTable3(p1: Player, p2: Player, last: Player, bet: number, results: PayoutResult[]) {
    // 1. Tiền thứ hạng
    results.push({ playerId: p1.id, change: bet, reason: "Nhất (+1 cược)" });
    results.push({ playerId: p2.id, change: 0, reason: "Nhì" });
    results.push({ playerId: last.id, change: -bet, reason: "Bét (-1 cược)" });

    // 2. Tiền thối
    const thoi = this.calculateThoi(last, bet);
    if (thoi.totalLoss > 0) {
      results.push({ playerId: p2.id, change: thoi.totalLoss, reason: `Nhì nhận thối: ${thoi.details.join(', ')}` });
      results.push({ playerId: last.id, change: -thoi.totalLoss, reason: `Thối bài: ${thoi.details.join(', ')}` });
    }
  }

  /**
   * V. BÀN 4 NGƯỜI
   * Tiền thứ hạng: Nhất +1, Nhì +0.5, Ba -0.5, Bét -1
   * Tiền thối: Bét -> Ba
   */
  private static settleTable4(p1: Player, p2: Player, p3: Player, last: Player, bet: number, results: PayoutResult[]) {
    // 1. Tiền thứ hạng
    results.push({ playerId: p1.id, change: bet, reason: "Nhất (+1 cược)" });
    results.push({ playerId: p2.id, change: bet * 0.5, reason: "Nhì (+0.5 cược)" });
    results.push({ playerId: p3.id, change: -bet * 0.5, reason: "Ba (-0.5 cược)" });
    results.push({ playerId: last.id, change: -bet, reason: "Bét (-1 cược)" });

    // 2. Tiền thối
    const thoi = this.calculateThoi(last, bet);
    if (thoi.totalLoss > 0) {
      results.push({ playerId: p3.id, change: thoi.totalLoss, reason: `Ba nhận thối: ${thoi.details.join(', ')}` });
      results.push({ playerId: last.id, change: -thoi.totalLoss, reason: `Thối bài: ${thoi.details.join(', ')}` });
    }
  }

  // Khương định các method cũ để tránh lỗi compile nếu nơi khác đang dùng
  static calculateThoiValue(p: Player, b: number) { return this.calculateThoi(p, b); }
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
  static calculateRankMoney(p: Player[], b: number) { return this.settleGame(p, b); }
  static calculateCongMoney(p: Player[], b: number) { return this.settleGame(p, b); }
}
