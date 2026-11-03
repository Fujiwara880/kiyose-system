const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// サーバー側メモリデータ（全端末間で一括共有）
let boardPosts = [];
let chatMessages = [];
let presences = new Map(); // socket.id -> presence
let blockedUids = new Set(); // ブロックされたユーザーID

app.use(express.static(path.join(__dirname)));

io.on('connection', (socket) => {
  // 接続時に現在の最新データを送信
  socket.emit('init-data', {
    board: boardPosts,
    chat: chatMessages
  });

  // 毎秒ハートビート（全端末の情報追跡）
  socket.on('presence-heartbeat', (data) => {
    if (blockedUids.has(data.uid)) {
      socket.emit('blocked');
      socket.disconnect(true);
      return;
    }

    presences.set(socket.id, {
      socketId: socket.id,
      uid: data.uid,
      name: data.name,
      role: data.role,
      device: data.device,
      tab: data.tab,
      tabName: data.tabName,
      loginTime: data.loginTime,
      lastActive: Date.now()
    });

    // 管理画面および全端末へ接続状況を自動一斉配信
    io.emit('presences-update', Array.from(presences.values()));
  });

  // 掲示板投稿
  socket.on('add-board', (data) => {
    if (blockedUids.has(data.uid)) return;
    const post = {
      id: 'b_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      text: data.text,
      name: data.name,
      uid: data.uid,
      time: Date.now()
    };
    boardPosts.unshift(post);
    io.emit('board-update', boardPosts);
  });

  // 掲示板削除
  socket.on('delete-board', (id) => {
    boardPosts = boardPosts.filter(p => p.id !== id);
    io.emit('board-update', boardPosts);
  });

  // 掲示板全消去
  socket.on('clear-board', () => {
    boardPosts = [];
    io.emit('board-update', boardPosts);
  });

  // チャットメッセージ
  socket.on('add-chat', (data) => {
    if (blockedUids.has(data.uid)) return;
    const msg = {
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      text: data.text,
      name: data.name,
      uid: data.uid,
      time: Date.now()
    };
    chatMessages.push(msg);
    io.emit('chat-update', chatMessages);
  });

  // チャット履歴消去
  socket.on('clear-chat', () => {
    chatMessages = [];
    io.emit('chat-update', chatMessages);
  });

  // 管理者による「即時ブロック」処理
  socket.on('block-user', (targetUid) => {
    blockedUids.add(targetUid);
    for (const [sId, p] of presences.entries()) {
      if (p.uid === targetUid) {
        io.to(sId).emit('blocked');
        const targetSocket = io.sockets.sockets.get(sId);
        if (targetSocket) targetSocket.disconnect(true);
        presences.delete(sId);
      }
    }
    io.emit('presences-update', Array.from(presences.values()));
  });

  // 全データ初期化
  socket.on('reset-all', () => {
    boardPosts = [];
    chatMessages = [];
    io.emit('board-update', boardPosts);
    io.emit('chat-update', chatMessages);
  });

  // 切断時のプレゼンス除去
  socket.on('disconnect', () => {
    presences.delete(socket.id);
    io.emit('presences-update', Array.from(presences.values()));
  });
});

server.listen(PORT, () => {
  console.log(`Kiyose System running on port ${PORT}`);
});