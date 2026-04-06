const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const GROUPS_FILE = path.join(__dirname, 'groups_store.json');

const groups = new Map();
const users = new Map();

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

function saveGroups() {
  try {
    const serializable = {};
    for (const [code, group] of groups.entries()) {
      serializable[code] = {
        groupName: group.groupName,
        groupCode: group.groupCode,
        messageHistory: group.messageHistory,
      };
    }
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(serializable), 'utf8');
  } catch (e) {
    console.error('Failed to save groups:', e.message);
  }
}

function loadGroups() {
  try {
    if (!fs.existsSync(GROUPS_FILE)) return;
    const data = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
    for (const [code, g] of Object.entries(data)) {
      const key = deriveKey(code);
      groups.set(code, {
        groupName: g.groupName,
        groupCode: g.groupCode,
        members: new Map(),
        messageHistory: g.messageHistory || [],
        key
      });
    }
    console.log(`Loaded ${groups.size} persisted group(s).`);
  } catch (e) {
    console.error('Failed to load groups:', e.message);
  }
}

app.use(express.static(path.join(__dirname, 'public')));
loadGroups();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register', ({ username }) => {
    const userId = uuidv4();
    users.set(socket.id, { username, userId, groupCode: null });
    socket.emit('registered', { userId, username });
  });

  socket.on('createGroup', ({ groupName }) => {
    const user = users.get(socket.id);
    if (!user) return socket.emit('error', { message: 'Not registered' });

    const groupCode = generateGroupCode();
    const key = deriveKey(groupCode);
    const group = { groupName, groupCode, members: new Map(), messageHistory: [], key };
    groups.set(groupCode, group);
    saveGroups();
    socket.emit('groupCreated', { groupCode, groupName });
  });

  socket.on('joinGroup', ({ groupCode, username }) => {
    const code = groupCode.replace(/-/g, '').toUpperCase();

    if (!user_exists_check(socket.id, username)) return;

    const user = users.get(socket.id);
    const group = groups.get(code);

    if (!group) return socket.emit('error', { message: 'Invalid group code. Check and try again.' });

    if (user.groupCode) leaveGroup(socket, user.groupCode);

    user.groupCode = code;
    group.members.set(socket.id, { username: user.username, userId: user.userId });
    socket.join(code);

    const history = group.messageHistory.map(msg => {
      try {
        const content = decryptMessage(msg.encrypted, group.key);
        return { id: msg.id, sender: msg.sender, content, type: msg.type, timestamp: msg.timestamp, edited: msg.edited };
      } catch (e) {
        return { id: msg.id, sender: msg.sender, content: '[Decryption failed]', type: msg.type, timestamp: msg.timestamp };
      }
    });

    const members = Array.from(group.members.values()).map(m => m.username);
    socket.emit('joinedGroup', { groupCode: code, groupName: group.groupName, history, members });

    const sysMsg = { id: uuidv4(), sender: 'SYSTEM', content: `${user.username} joined the channel`, type: 'system', timestamp: Date.now() };
    const encSys = encryptMessage(sysMsg.content, group.key);
    group.messageHistory.push({ ...sysMsg, encrypted: encSys });
    saveGroups();
    io.to(code).emit('newMessage', sysMsg);
  });

  function user_exists_check(socketId, username) {
    if (!users.has(socketId)) {
      if (username) {
        users.set(socketId, { username, userId: uuidv4(), groupCode: null });
      } else {
        socket.emit('error', { message: 'Not registered' });
        return false;
      }
    }
    return true;
  }

  socket.on('sendMessage', ({ groupCode, content, type }) => {
    const code = groupCode.replace(/-/g, '').toUpperCase();
    const user = users.get(socket.id);
    const group = groups.get(code);
    if (!user || !group) return socket.emit('error', { message: 'Not in a group' });

    const msgId = uuidv4();
    const encrypted = encryptMessage(typeof content === 'string' ? content : JSON.stringify(content), group.key);
    const msg = { id: msgId, sender: user.username, senderId: user.userId, encrypted, type: type || 'text', timestamp: Date.now(), edited: false };
    group.messageHistory.push(msg);
    saveGroups();

    io.to(code).emit('newMessage', { id: msgId, sender: user.username, senderId: user.userId, content, type: type || 'text', timestamp: msg.timestamp, edited: false });
  });

  socket.on('editMessage', ({ groupCode, messageId, newText }) => {
    const code = groupCode.replace(/-/g, '').toUpperCase();
    const user = users.get(socket.id);
    const group = groups.get(code);
    if (!user || !group) return;

    const msg = group.messageHistory.find(m => m.id === messageId);
    if (!msg || msg.sender !== user.username) return socket.emit('error', { message: 'Cannot edit this message' });

    msg.encrypted = encryptMessage(newText, group.key);
    msg.edited = true;
    saveGroups();
    io.to(code).emit('messageEdited', { messageId, newContent: newText });
  });

  socket.on('typing', ({ groupCode }) => {
    const code = groupCode.replace(/-/g, '').toUpperCase();
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(code).emit('userTyping', { username: user.username });
  });

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

    // FIX: never delete the group — keep it alive for future joins
    saveGroups();
  }

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user && user.groupCode) leaveGroup(socket, user.groupCode);
    users.delete(socket.id);
  });
});

server.listen(PORT, () => console.log(`CryptChat running on port ${PORT}`));
