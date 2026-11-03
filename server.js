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

// サーバー側パスワード保持
const ADMIN_PASS = "E8NGF27R";
const GUEST_PASS = "F-52E";

let boardPosts = [];
let chatMessages = [];
let presences = new Map();
let blockedUids = new Set();

// 静的ファイルの提供
app.use(express.static(path.join(__dirname)));

// ルーティングフォールバック (Cannot GET エラー防止)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 5秒以上ハートビートがない非アクティブ接続を自動削除
setInterval(() => {
  const now = Date.now();
  let updated = false;
  for (const [sId, p] of presences.entries()) {
    if (now - p.lastActive > 5000) {
      presences.delete(sId);
      updated = true;
    }
  }
  if (updated) {
    sendPresencesUpdate();
  }
}, 3000);

function sendPresencesUpdate() {
  const presenceArray = Array.from(presences.values()).map(p => ({
    ...p,
    isBlocked: blockedUids.has(p.uid)
  }));
  
  io.emit('presences-update', {
    presences: presenceArray,
    blockedUids: Array.from(blockedUids)
  });
}

io.on('connection', (socket) => {

  // 1. サーバー側認証処理
  socket.on('authenticate', (data) => {
    if (blockedUids.has(data.uid)) {
      socket.emit('auth-result', { success: false, message: 'この端末は管理者によりブロックされています。' });
      return;
    }

    let role = null;
    if (data.password === ADMIN_PASS) {
      role = 'admin';
    } else if (data.password === GUEST_PASS) {
      role = 'guest';
    } else {
      socket.emit('auth-result', { success: false, message: 'パスワードが違います。' });
      return;
    }

    socket.emit('auth-result', {
      success: true,
      role: role,
      name: data.username,
      uid: data.uid
    });

    socket.emit('init-data', {
      board: boardPosts,
      chat: chatMessages
    });
  });

  // 2. ハートビート
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

    sendPresencesUpdate();
  });

  // 掲示板
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

  socket.on('delete-board', (id) => {
    boardPosts = boardPosts.filter(p => p.id !== id);
    io.emit('board-update', boardPosts);
  });

  socket.on('clear-board', () => {
    boardPosts = [];
    io.emit('board-update', boardPosts);
  });

  // チャット
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

  socket.on('clear-chat', () => {
    chatMessages = [];
    io.emit('chat-update', chatMessages);
  });

  // ブロック処理
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
    sendPresencesUpdate();
  });

  // ブロック解除
  socket.on('unblock-user', (targetUid) => {
    blockedUids.delete(targetUid);
    sendPresencesUpdate();
  });

  // 初期化
  socket.on('reset-all', () => {
    boardPosts = [];
    chatMessages = [];
    io.emit('board-update', boardPosts);
    io.emit('chat-update', chatMessages);
  });

  // 切断
  socket.on('disconnect', () => {
    presences.delete(socket.id);
    sendPresencesUpdate();
  });
});

// Render.com等のホスティング環境向けに 0.0.0.0 バインドを設定
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Kiyose System running on port ${PORT}`);
});
