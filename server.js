const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

// In-memory storage
const groups = new Map();   // groupCode -> { groupName, groupCode, members: Map, messageHistory: [], key }
const users = new Map();    // socketId -> { username, userId, groupCode }

// Encryption
function deriveKey(groupCode) {
  return crypto.scryptSync(groupCode, 'cryptchat-salt', 32);
}

function encryptMessage(text, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { iv: iv.toString('hex'), authTag: authTag.toString('hex'), data: encrypted.toString('hex') };
}

function decryptMessage(encrypted, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));
  return decipher.update(Buffer.from(encrypted.data, 'hex')) + decipher.final('utf8');
}

function generateGroupCode() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Register user
  socket.on('register', ({ username }) => {
    const userId = uuidv4();
    users.set(socket.id, { username, userId, groupCode: null });
    socket.emit('registered', { userId, username });
  });

  // Create group
  socket.on('createGroup', ({ groupName }) => {
    const user = users.get(socket.id);
    if (!user) return socket.emit('error', { message: 'Not registered' });

    const groupCode = generateGroupCode();
    const key = deriveKey(groupCode);
    const group = {
      groupName,
      groupCode,
      members: new Map(),
      messageHistory: [],
      key
    };
    groups.set(groupCode, group);
    socket.emit('groupCreated', { groupCode, groupName });
  });

  // Join group
  socket.on('joinGroup', ({ groupCode, username }) => {
    const code = groupCode.replace(/-/g, '').toUpperCase();
    const group = groups.get(code);

    if (!user_exists_check(socket.id, username)) return;
    if (!group) return socket.emit('error', { message: 'Invalid group code. Check and try again.' });

    const user = users.get(socket.id);
    // Leave previous group
    if (user.groupCode) {
      leaveGroup(socket, user.groupCode);
    }

    user.groupCode = code;
    group.members.set(socket.id, { username: user.username, userId: user.userId });

    socket.join(code);

    // Decrypt history for this user
    const history = group.messageHistory.map(msg => {
      try {
        const content = decryptMessage(msg.encrypted, group.key);
        return { id: msg.id, sender: msg.sender, content, type: msg.type, timestamp: msg.timestamp, edited: msg.edited };
      } catch (e) {
        return { id: msg.id, sender: msg.sender, content: '[Decryption failed]', type: msg.type, timestamp: msg.timestamp };
      }
    });

    const members = Array.from(group.members.values()).map(m => m.username);

    socket.emit('joinedGroup', {
      groupCode: code,
      groupName: group.groupName,
      history,
      members
    });

    // System message
    const sysMsg = { id: uuidv4(), sender: 'SYSTEM', content: `${user.username} joined the channel`, type: 'system', timestamp: Date.now() };
    const encSys = encryptMessage(sysMsg.content, group.key);
    group.messageHistory.push({ ...sysMsg, encrypted: encSys });
    io.to(code).emit('newMessage', sysMsg);
  });

  function user_exists_check(socketId, username) {
    if (!users.has(socketId)) {
      if (username) {
        const userId = uuidv4();
        users.set(socketId, { username, userId, groupCode: null });
      } else {
        socket.emit('error', { message: 'Not registered' });
        return false;
      }
    }
    return true;
  }

  // Send message
  socket.on('sendMessage', ({ groupCode, content, type }) => {
    const code = groupCode.replace(/-/g, '').toUpperCase();
    const user = users.get(socket.id);
    const group = groups.get(code);

    if (!user || !group) return socket.emit('error', { message: 'Not in a group' });

    const msgId = uuidv4();
    const encrypted = encryptMessage(typeof content === 'string' ? content : JSON.stringify(content), group.key);
    const msg = {
      id: msgId,
      sender: user.username,
      senderId: user.userId,
      encrypted,
      type: type || 'text',
      timestamp: Date.now(),
      edited: false
    };
    group.messageHistory.push(msg);

    io.to(code).emit('newMessage', {
      id: msgId,
      sender: user.username,
      senderId: user.userId,
      content,
      type: type || 'text',
      timestamp: msg.timestamp,
      edited: false
    });
  });

  // Edit message
  socket.on('editMessage', ({ groupCode, messageId, newText }) => {
    const code = groupCode.replace(/-/g, '').toUpperCase();
    const user = users.get(socket.id);
    const group = groups.get(code);
    if (!user || !group) return;

    const msg = group.messageHistory.find(m => m.id === messageId);
    if (!msg || msg.sender !== user.username) return socket.emit('error', { message: 'Cannot edit this message' });

    const encrypted = encryptMessage(newText, group.key);
    msg.encrypted = encrypted;
    msg.edited = true;

    io.to(code).emit('messageEdited', { messageId, newContent: newText });
  });

  // Typing indicator
  socket.on('typing', ({ groupCode }) => {
    const code = groupCode.replace(/-/g, '').toUpperCase();
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(code).emit('userTyping', { username: user.username });
  });

  // Leave group
  socket.on('leaveGroup', ({ groupCode }) => {
    const code = groupCode.replace(/-/g, '').toUpperCase();
    leaveGroup(socket, code);
    socket.emit('leftGroup');
  });

  function leaveGroup(socket, code) {
    const user = users.get(socket.id);
    const group = groups.get(code);
    if (!group || !user) return;

    group.members.delete(socket.id);
    socket.leave(code);
    user.groupCode = null;

    const sysMsg = { id: uuidv4(), sender: 'SYSTEM', content: `${user.username} left the channel`, type: 'system', timestamp: Date.now() };
    const encSys = encryptMessage(sysMsg.content, group.key);
    group.messageHistory.push({ ...sysMsg, encrypted: encSys });
    io.to(code).emit('newMessage', sysMsg);
    io.to(code).emit('userLeft', { username: user.username });

    // Cleanup empty groups
    if (group.members.size === 0) {
      groups.delete(code);
    }
  }

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user && user.groupCode) {
      leaveGroup(socket, user.groupCode);
    }
    users.delete(socket.id);
  });
});

server.listen(PORT, () => console.log(`CryptChat running on port ${PORT}`));
