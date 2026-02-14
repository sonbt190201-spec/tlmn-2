
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager, Room } from './roomManager.js';
import { GameInstance } from './gameInstance.js';
import { MoneyEngine } from './moneyEngine.js';
import { HandType, GlobalPlayerStats, GameHistory } from './types.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const roomManager = new RoomManager();

const DATA_DIR = path.join(__dirname, 'data');
const BALANCES_FILE = path.join(DATA_DIR, 'balances.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

interface PersistentPlayer {
  id: string;
  name: string;
  balance: number;
  stats: GlobalPlayerStats;
}

let persistentPlayers: Record<string, PersistentPlayer> = {};
let globalHistory: Record<string, GameHistory[]> = {};

function loadData() {
  try {
    if (fs.existsSync(BALANCES_FILE)) {
      persistentPlayers = JSON.parse(fs.readFileSync(BALANCES_FILE, 'utf-8'));
    }
    if (fs.existsSync(HISTORY_FILE)) {
      globalHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error("Lỗi load data:", err);
  }
}

function saveData() {
  try {
    fs.writeFileSync(BALANCES_FILE, JSON.stringify(persistentPlayers, null, 2));
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(globalHistory, null, 2));
  } catch (err) {
    console.error("Lỗi save data:", err);
  }
}

loadData();

const distPath = path.resolve(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath) as any);
} else {
  app.use(express.static(__dirname) as any);
}

function updateGlobalStats(room: Room) {
  if (!room.game) return;
  const lastGame = room.game.history[0];
  if (!lastGame) return;

  if (!globalHistory[room.id]) globalHistory[room.id] = [];
  globalHistory[room.id].unshift(lastGame);
  if (globalHistory[room.id].length > 100) globalHistory[room.id] = globalHistory[room.id].slice(0, 100);

  lastGame.players.forEach(p => {
    if (!persistentPlayers[p.id]) {
       persistentPlayers[p.id] = {
         id: p.id,
         name: p.name,
         balance: p.balanceAfter,
         stats: createEmptyStats()
       };
    }
    
    const ps = persistentPlayers[p.id];
    ps.balance = p.balanceAfter;
    ps.stats.totalRounds++;
    
    if (p.change > 0) {
      ps.stats.totalWin++;
      ps.stats.totalMoneyWin += p.change;
    } else if (p.change < 0) {
      ps.stats.totalLose++;
      ps.stats.totalMoneyLose += Math.abs(p.change);
    }

    if (p.isBurned) ps.stats.totalCongCount++;

    lastGame.events.forEach(ev => {
      if (ev.toPlayerId === p.id && (ev.type === 'CHOP' || ev.type === 'OVER_CHOP')) {
        ps.stats.totalHeoCut++;
      }
      if (ev.fromPlayerId === p.id && ev.type === 'THOI') {
        ps.stats.totalHeoBurn++;
      }
    });
  });

  saveData();
}

function createEmptyStats(): GlobalPlayerStats {
  return {
    totalRounds: 0,
    totalWin: 0,
    totalLose: 0,
    totalMoneyWin: 0,
    totalMoneyLose: 0,
    totalHeoCut: 0,
    totalHeoBurn: 0,
    totalCongCount: 0
  };
}

const server = app.listen(port, () => {
  console.log(`Server đang chạy tại port ${port}`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let clientId = '';
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      const room = roomManager.getRoomByClientId(clientId);

      switch (message.type) {
        case 'JOIN_ROOM':
          clientId = message.payload.id;
          const joinedRoom = roomManager.joinRoom(clientId, message.payload.name, ws, message.payload.roomId);
          
          if (!persistentPlayers[clientId]) {
            persistentPlayers[clientId] = {
              id: clientId,
              name: message.payload.name,
              balance: 1000000,
              stats: createEmptyStats()
            };
          }
          
          const roomPlayersWithBalance = joinedRoom.playerInfos.map(p => ({
            ...p,
            balance: persistentPlayers[p.id]?.balance || 1000000
          }));

          broadcast(joinedRoom, {
            type: 'ROOM_UPDATE',
            payload: { players: roomPlayersWithBalance, roomId: joinedRoom.id }
          });

          if (!joinedRoom.game) {
             joinedRoom.game = new GameInstance(roomPlayersWithBalance, 10000);
             const history = globalHistory[joinedRoom.id] || [];
             if (typeof joinedRoom.game.setHistory === 'function') {
                joinedRoom.game.setHistory(history);
             }
          }

          broadcastGameState(joinedRoom);
          break;

        case 'START_GAME':
          if (room && (!room.game || room.game.gamePhase !== 'playing')) {
            try {
              const playersData = room.playerInfos.slice(0, 4).map(p => ({
                id: p.id,
                name: p.name,
                balance: persistentPlayers[p.id]?.balance || 1000000
              }));

              if (playersData.length < 2) {
                ws.send(JSON.stringify({ type: 'ERROR', payload: "Cần ít nhất 2 người chơi để bắt đầu!" }));
                return;
              }

              const currentBet = room.game ? room.game.bet : 10000;
              const prevHistory = room.game ? room.game.history : (globalHistory[room.id] || []);
              const prevInternal = room.game ? room.game.getInternalState() : null;
              
              const newGame = new GameInstance(playersData, currentBet);
              
              if (typeof newGame.setHistory === 'function') {
                newGame.setHistory(prevHistory);
              }
              
              if (prevInternal && typeof newGame.setPersistentState === 'function') {
                newGame.setPersistentState(prevInternal);
              }

              room.game = newGame;
              room.game.startNewRound();
              
              if (room.game.gamePhase === 'finished') updateGlobalStats(room);
              broadcastGameState(room);
            } catch (err: any) {
              console.error("Lỗi Start Game:", err);
              ws.send(JSON.stringify({ type: 'ERROR', payload: err.message || "Lỗi khởi tạo game" }));
            }
          }
          break;

        case 'UPDATE_BET':
          if (room?.game) {
            room.game.bet = message.payload.bet;
            broadcastGameState(room);
          }
          break;

        case 'PLAY_CARDS':
          if (room?.game) {
            const prevPhase = room.game.gamePhase;
            const error = room.game.playMove(clientId, message.payload.cardIds);
            
            if (!error) {
              // Sau khi đánh bài, kiểm tra xem có sự kiện đặc biệt (Chặt heo/hàng) không
              const currentMove = room.game.lastMove;
              if (currentMove?.isChop || currentMove?.isOverChop) {
                let chopType: any = "three_pairs";
                if (currentMove.type === HandType.FOUR_OF_A_KIND) chopType = "four_of_a_kind";
                else if (currentMove.type === HandType.FOUR_CONSECUTIVE_PAIRS) chopType = "four_pairs";

                const player = room.playerInfos.find(p => p.id === clientId);
                broadcast(room, {
                  type: 'SPECIAL_EVENT',
                  payload: { 
                    type: currentMove.isOverChop ? 'chat_chong' : 'chat_heo', 
                    playerName: player?.name || 'Ẩn danh',
                    chopType: chopType
                  }
                });
              }

              if (prevPhase === 'playing' && room.game.gamePhase === 'finished') {
                updateGlobalStats(room);
                const lastGame = room.game.history[0];
                if (lastGame) {
                  lastGame.events.forEach(ev => {
                    let specialType = 'info';
                    let displayPlayerName = ev.playerName;

                    if (ev.type === 'CHOP') {
                      specialType = 'chat_heo';
                      displayPlayerName = ev.targetName; // Hiển thị "X BỊ CHẶT HEO"
                    }
                    else if (ev.type === 'OVER_CHOP') {
                      specialType = 'chat_chong';
                      displayPlayerName = ev.targetName; // Hiển thị "X BỊ CHẶT CHỒNG"
                    }
                    else if (ev.type === 'THOI') specialType = 'thui_heo';
                    else if (ev.type === 'CONG') specialType = 'chay_bai';
                    
                    broadcast(room, {
                      type: 'SPECIAL_EVENT',
                      payload: { type: specialType, playerName: displayPlayerName, chopType: 'three_pairs' }
                    });
                  });
                }
              }
              broadcastGameState(room);
            } else {
              ws.send(JSON.stringify({ type: 'ERROR', payload: error }));
            }
          }
          break;

        case 'PASS_TURN':
          if (room?.game) {
            room.game.passTurn(clientId);
            broadcastGameState(room);
          }
          break;

        case 'SEND_CHAT':
           if (room) {
             broadcast(room, {
               type: 'CHAT_UPDATE',
               payload: {
                 id: Math.random().toString(36).substr(2, 9),
                 playerId: clientId,
                 playerName: room.playerInfos.find(p => p.id === clientId)?.name || 'Ẩn danh',
                 message: message.payload.message,
                 timestamp: Date.now()
               }
             });
           }
           break;

        case 'SEND_TROLL':
          if (room) {
            broadcast(room, {
              type: 'TROLL_EVENT',
              payload: {
                id: Math.random().toString(36).substr(2, 9),
                type: message.payload.type,
                fromId: clientId,
                toId: message.payload.toId,
                timestamp: Date.now()
              }
            });
          }
          break;
          
        case 'VOICE_SIGNAL':
          if (room) {
            const targetWs = room.clients.get(message.payload.toId);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
              targetWs.send(JSON.stringify({
                type: 'VOICE_SIGNAL_RECV',
                payload: { fromId: clientId, signal: message.payload.signal, type: message.payload.type }
              }));
            }
          }
          break;
      }
    } catch (e) {
      console.error("Lỗi xử lý tin nhắn tổng quát:", e);
    }
  });

  ws.on('close', () => {
    const room = roomManager.leaveRoom(clientId);
    if (room) {
      const roomPlayersWithBalance = room.playerInfos.map(p => ({
        ...p,
        balance: persistentPlayers[p.id]?.balance || 1000000
      }));
      broadcast(room, {
        type: 'ROOM_UPDATE',
        payload: { players: roomPlayersWithBalance, roomId: room.id }
      });
      
      if (room.game && room.game.gamePhase !== 'playing') {
        room.game = new GameInstance(roomPlayersWithBalance, room.game.bet);
      }
      
      broadcastGameState(room);
    }
  });
});

function broadcast(room: any, data: any) {
  room.clients.forEach((clientWs: WebSocket) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(data));
  });
}

function broadcastGameState(room: any) {
  if (!room.game) return;
  room.clients.forEach((clientWs: WebSocket, id: string) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      const state = room.game!.getState(id);
      clientWs.send(JSON.stringify({
        type: 'GAME_STATE',
        payload: {
          ...state,
          globalStats: persistentPlayers[id]?.stats || createEmptyStats()
        }
      }));
    }
  });
}

app.get('*', (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else {
    const rootIndexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(rootIndexPath)) res.sendFile(rootIndexPath);
    else res.status(404).send('Vui lòng chạy build.');
  }
});
