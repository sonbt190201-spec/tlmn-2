
import { GameInstance } from './gameInstance.js';
import { v4 as uuidv4 } from 'uuid';

export interface Room {
  id: string;
  clients: Map<string, any>; // id -> ws
  game: GameInstance | null;
  playerInfos: { id: string, name: string }[];
}

export class RoomManager {
  rooms: Map<string, Room> = new Map();

  joinRoom(clientId: string, clientName: string, ws: any, preferredRoomId?: string): Room {
    let room: Room | undefined;

    if (preferredRoomId) {
      room = this.rooms.get(preferredRoomId);
    }

    if (!room) {
      for (const r of this.rooms.values()) {
        if (r.playerInfos.length < 4) { // Giới hạn 4 người chơi theo luật Tiến Lên
          room = r;
          break;
        }
      }
    }

    if (!room) {
      const id = preferredRoomId || uuidv4().slice(0, 8);
      room = {
        id,
        clients: new Map(),
        game: null,
        playerInfos: []
      };
      this.rooms.set(id, room);
    }

    room.clients.set(clientId, ws);
    
    // Ngăn chặn trùng lặp ID người chơi trong cùng một phòng
    const existingPlayerIdx = room.playerInfos.findIndex(p => p.id === clientId);
    if (existingPlayerIdx !== -1) {
      room.playerInfos[existingPlayerIdx].name = clientName;
    } else {
      room.playerInfos.push({ id: clientId, name: clientName });
    }
    
    return room;
  }

  leaveRoom(clientId: string) {
    for (const room of this.rooms.values()) {
      if (room.clients.has(clientId)) {
        room.clients.delete(clientId);
        room.playerInfos = room.playerInfos.filter(p => p.id !== clientId);
        if (room.playerInfos.length === 0) {
          this.rooms.delete(room.id);
        }
        return room;
      }
    }
    return null;
  }

  getRoomByClientId(clientId: string): Room | null {
    for (const room of this.rooms.values()) {
      if (room.clients.has(clientId)) return room;
    }
    return null;
  }
}
