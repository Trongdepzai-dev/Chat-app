const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcrypt');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from 'public' directory
app.use(express.static('public'));

// Declare variables for users, messages, friend requests, and bans
let users = [];
let messages = { public: [] };
let friendRequests = [];
let bans = [];

// Load data from the file system
const loadData = () => {
  try {
    const data = fs.readFileSync('data.json', 'utf8');
    const parsed = JSON.parse(data);
    users = parsed.users || [];
    messages = parsed.messages || { public: [] };
    friendRequests = parsed.friendRequests || [];
    bans = parsed.bans || [];
  } catch (err) {
    console.log('No data file found, starting fresh.');
  }
};

// Save data to the file system
const saveData = () => {
  fs.writeFileSync('data.json', JSON.stringify({ users, messages, friendRequests, bans }, null, 2));
};

// Load the data when the server starts
loadData();

// Find the public IP address of the machine
let ipAddress = 'localhost'; // fallback

const networkInterfaces = os.networkInterfaces();
for (const interfaceName in networkInterfaces) {
  const iface = networkInterfaces[interfaceName];
  for (const ifaceDetails of iface) {
    if (ifaceDetails.family === 'IPv4' && !ifaceDetails.internal) {
      ipAddress = ifaceDetails.address;
      break;
    }
  }
}

// Handle WebSocket connections using Socket.io
io.on('connection', (socket) => {

  socket.on('register', async ({ username, password }) => {
    if (users.find(u => u.username === username)) {
      socket.emit('registerFailure', 'Username already exists');
      return;
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = { id: users.length + 1, username, password: hashedPassword, isAdmin: users.length === 0 };
    users.push(user);
    saveData();
    socket.emit('registerSuccess');
  });

  socket.on('login', async ({ username, password }) => {
    const user = users.find(u => u.username === username);
    if (!user) {
      socket.emit('loginFailure', 'User not found');
      return;
    }
    const ban = bans.find(b => b.userId === user.id && (b.expires > Date.now() || b.expires === 0));
    if (ban) {
      socket.emit('loginFailure', 'You are banned');
      return;
    }
    if (await bcrypt.compare(password, user.password)) {
      socket.user = user;
      socket.join(user.id.toString());
      socket.emit('loginSuccess', user);
    } else {
      socket.emit('loginFailure', 'Incorrect password');
    }
  });

  socket.on('logout', () => {
    socket.user = null;
    socket.leaveAll();
  });

  socket.on('message', ({ chat, message }) => {
    if (!socket.user) return;
    const msg = { user: { id: socket.user.id, username: socket.user.username, isAdmin: socket.user.isAdmin }, message };
    if (!messages[chat]) messages[chat] = [];
    messages[chat].push(msg);
    saveData();
    io.emit('message', { chat, message, user: msg.user });
  });

  socket.on('searchUsers', (query) => {
    if (!socket.user) return;
    const results = users.filter(u => u.username.toLowerCase().includes(query.toLowerCase()) && u.id !== socket.user.id);
    socket.emit('searchResults', results.map(u => ({ id: u.id, username: u.username, isAdmin: u.isAdmin })));
  });

  socket.on('friendRequest', (toUserId) => {
    if (!socket.user) return;
    const toUser = users.find(u => u.id === toUserId);
    if (!toUser || toUser.id === socket.user.id) return;
    if (friendRequests.some(fr => fr.fromId === socket.user.id && fr.toId === toUserId)) return;
    const request = { id: friendRequests.length + 1, fromId: socket.user.id, fromUsername: socket.user.username, toId: toUserId };
    friendRequests.push(request);
    saveData();
    io.to(toUserId.toString()).emit('friendRequest', request);
  });

  socket.on('acceptFriendRequest', (requestId) => {
    if (!socket.user) return;
    const request = friendRequests.find(fr => fr.id === requestId && fr.toId === socket.user.id);
    if (!request) return;
    const chatId = `chat_${Math.random().toString(36).substr(2, 9)}`;
    friendRequests = friendRequests.filter(fr => fr.id !== requestId);
    io.to(request.fromId.toString()).emit('friendRequestAccepted', {
      friend: { id: socket.user.id, username: socket.user.username, chatId, isAdmin: socket.user.isAdmin },
      chatId
    });
    socket.emit('friendRequestAccepted', {
      friend: { id: request.fromId, username: request.fromUsername, chatId, isAdmin: users.find(u => u.id === request.fromId).isAdmin },
      chatId
    });
    saveData();
  });

  socket.on('rejectFriendRequest', (requestId) => {
    if (!socket.user) return;
    friendRequests = friendRequests.filter(fr => fr.id !== requestId && fr.toId === socket.user.id);
    saveData();
  });

  socket.on('startChat', (toUserId) => {
    if (!socket.user) return;
    const toUser = users.find(u => u.id === toUserId);
    if (!toUser) return;
    const existingChat = Object.keys(messages).find(chatId => 
      chatId !== 'public' && messages[chatId].some(msg => 
        (msg.user.id === socket.user.id && msg.user.id === toUserId) || 
        (msg.user.id === toUserId && msg.user.id === socket.user.id)
      )
    );
    if (existingChat) {
      socket.emit('friendRequestAccepted', {
        friend: { id: toUser.id, username: toUser.username, chatId: existingChat, isAdmin: toUser.isAdmin },
        chatId: existingChat
      });
    } else {
      const chatId = `chat_${Math.random().toString(36).substr(2, 9)}`;
      messages[chatId] = [];
      io.to(toUserId.toString()).emit('friendRequestAccepted', {
        friend: { id: socket.user.id, username: socket.user.username, chatId, isAdmin: socket.user.isAdmin },
        chatId
      });
      socket.emit('friendRequestAccepted', {
        friend: { id: toUser.id, username: toUser.username, chatId, isAdmin: toUser.isAdmin },
        chatId
      });
      saveData();
    }
  });

  socket.on('getConversations', () => {
    if (!socket.user) return;
    const friends = [];
    const privateMessages = {};
    friendRequests.filter(fr => fr.toId === socket.user.id).forEach(fr => {
      friends.push({ id: fr.fromId, username: fr.fromUsername, chatId: null });
    });
    Object.keys(messages).forEach(chatId => {
      if (chatId !== 'public' && messages[chatId].some(msg => msg.user.id === socket.user.id)) {
        const otherUserId = messages[chatId].find(msg => msg.user.id !== socket.user.id)?.user.id;
        if (otherUserId) {
          const otherUser = users.find(u => u.id === otherUserId);
          friends.push({ id: otherUser.id, username: otherUser.username, chatId, isAdmin: otherUser.isAdmin });
          privateMessages[chatId] = messages[chatId];
        }
      }
    });
    socket.emit('conversations', {
      public: messages.public,
      private: privateMessages,
      friends,
      friendRequests: friendRequests.filter(fr => fr.toId === socket.user.id)
    });
  });

  socket.on('exportUsers', () => {
    if (!socket.user || !socket.user.isAdmin) return;
    const csv = users.map(u => `${u.id},${u.username},${u.isAdmin}`).join('\n');
    socket.emit('exportUsers', csv);
  });

  socket.on('banUser', ({ userId, duration }) => {
    if (!socket.user || !socket.user.isAdmin) return;
    const user = users.find(u => u.id === userId);
    if (!user) {
      socket.emit('banFailure', 'User not found');
      return;
    }
    if (user.isAdmin) {
      socket.emit('banFailure', 'Cannot ban an admin');
      return;
    }
    const expires = duration === 0 ? 0 : Date.now() + duration * 24 * 60 * 60 * 1000;
    bans.push({ userId, expires });
    saveData();
    socket.emit('banSuccess', `User ${user.username} banned`);
    io.to(userId.toString()).emit('userBanned');
  });

  socket.on('disconnect', () => {
    if (socket.user) {
      socket.user = null;
      socket.leaveAll();
    }
  });
});

// Start the server and output the public IP address
server.listen(5173, '0.0.0.0', () => {
  console.log(`Server running on http://${ipAddress}:5173`);
});

app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});
