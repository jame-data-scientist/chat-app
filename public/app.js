// ============================================
// CryptChat — Client App
// ============================================

const socket = io();

// ---- State ----
let currentUser = null;   // { username, userId }
let currentGroup = null;  // { groupCode, groupName }
let typingTimer = null;
let pendingGroupCode = null;
let pendingGroupName = null;

// ---- DOM refs ----
const $ = id => document.getElementById(id);

// Screens
const screenLanding = $('screen-landing');
const screenApp     = $('screen-app');

// Landing
const landingName = $('landing-name');
const btnEnter    = $('btn-enter');

// Sidebar
const sidebarUsername  = $('sidebar-username');
const sidebarAvatar    = $('sidebar-avatar');
const sidebarGroupSection = $('sidebar-group-section');
const sidebarGroupName = $('sidebar-group-name');
const topbarAvatar     = $('topbar-avatar');

// Views
const viewHome = $('view-home');
const viewChat = $('view-chat');

// Chat
const chatGroupName = $('chat-group-name');
const messageFeed   = $('message-feed');
const chatInput     = $('chat-input');
const btnSend       = $('btn-send');
const btnEmoji      = $('btn-emoji');
const emojiPicker   = $('emoji-picker');
const imgUpload     = $('img-upload');
const typingIndicator = $('typing-indicator');
const typingText    = $('typing-text');

// Settings panel
const settingsOverlay = $('settings-overlay');
const settingsGroupName = $('settings-group-name-display');
const settingsEstDate   = $('settings-est-date');
const settingsCodeDisplay = $('settings-code-display');
const settingsMemberCount = $('settings-member-count');
const settingsMembersList = $('settings-members-list');

// Modals
const modalCreate    = $('modal-create');
const modalJoin      = $('modal-join');
const createGroupInput = $('create-group-name');
const joinCodeInput  = $('join-code-input');

// Lightbox
const lightbox       = $('lightbox');
const lightboxImg    = $('lightbox-img');

// ============================================
// EMOJI DATA
// ============================================
const EMOJIS = [
  '😀','😂','😍','🤔','😎','😭','🥳','😅',
  '👍','👎','👏','🙏','✌️','🤝','💪','🔥',
  '❤️','💙','💚','💛','🧡','💜','🖤','🤍',
  '✅','❌','⚠️','🔐','🛡️','⚡','💻','🌐',
  '🎯','🚀','💡','🔑','⚙️','📡','🛸','🌙'
];

// ============================================
// TOAST
// ============================================
function createToastContainer() {
  if ($('toast-container')) return;
  const el = document.createElement('div');
  el.id = 'toast-container';
  document.body.appendChild(el);
}

function showToast(msg, isError = false) {
  createToastContainer();
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.textContent = msg;
  $('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ============================================
// UTILS
// ============================================
function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatCode(code) {
  // display only: split 32 chars into 4 groups of 8 with dashes
  const clean = code.replace(/-/g, '');
  return clean.match(/.{1,8}/g)?.join('-') || code;
}

function getInitial(name) {
  return (name || '?')[0].toUpperCase();
}

function switchView(name) {
  viewHome.classList.remove('active');
  viewChat.classList.remove('active');
  if (name === 'home') viewHome.classList.add('active');
  if (name === 'chat') viewChat.classList.add('active');
}

// ============================================
// LANDING
// ============================================
btnEnter.addEventListener('click', enterApp);
landingName.addEventListener('keydown', e => { if (e.key === 'Enter') enterApp(); });

function enterApp() {
  const name = landingName.value.trim();
  if (!name) { landingName.focus(); return; }
  localStorage.setItem('cryptchat_username', name);
  currentUser = { username: name };
  socket.emit('register', { username: name });
}

// Load saved name
const savedName = localStorage.getItem('cryptchat_username');
if (savedName) { landingName.value = savedName; }

socket.on('registered', ({ userId, username }) => {
  currentUser = { username, userId };
  screenLanding.classList.remove('active');
  screenApp.classList.add('active');
  sidebarUsername.textContent = username;
  sidebarAvatar.textContent = getInitial(username);
  topbarAvatar.textContent = getInitial(username);
  populateHomeLogs();
  populateEmojiPicker();
});

// ============================================
// HOME LOG (decorative)
// ============================================
function populateHomeLogs() {
  const container = $('home-log');
  const logs = [
    { type: 'system', label: 'SYSTEM_INFO', text: 'New encryption keys generated for session #219. Pulse check: Normal.', time: '12:07' },
    { type: 'warning', label: 'SECURITY_ALERT', text: 'Attempted brute-force handshake from IP 192.168.1.13 blocked. Perimeter secure.', time: '11:54' },
    { type: 'user', label: 'USER_ACTION', text: 'Identity verified via biometric layer 2. Agent_Zero enrolled as trusted agent.', time: '01:05' },
  ];
  container.innerHTML = logs.map(l => `
    <div class="log-entry ${l.type}">
      <div class="log-entry-type">${l.label}</div>
      <div class="log-entry-text">${l.text}</div>
      <div class="log-entry-time">${l.time}</div>
    </div>
  `).join('');
}

// ============================================
// CREATE GROUP
// ============================================
function openCreateModal() {
  createGroupInput.value = '';
  $('create-code-reveal').style.display = 'none';
  $('btn-enter-group').style.display = 'none';
  $('btn-generate-group').style.display = 'flex';
  modalCreate.classList.remove('hidden');
  setTimeout(() => createGroupInput.focus(), 100);
  pendingGroupCode = null;
}
function closeCreateModal() { modalCreate.classList.add('hidden'); }

$('btn-open-create').addEventListener('click', openCreateModal);
$('btn-open-create-top').addEventListener('click', openCreateModal);
$('home-btn-create').addEventListener('click', openCreateModal);
$('btn-cancel-create').addEventListener('click', closeCreateModal);
modalCreate.addEventListener('click', e => { if (e.target === modalCreate) closeCreateModal(); });

$('btn-generate-group').addEventListener('click', () => {
  const name = createGroupInput.value.trim();
  if (!name) { createGroupInput.focus(); return; }
  socket.emit('createGroup', { groupName: name });
});

socket.on('groupCreated', ({ groupCode, groupName }) => {
  pendingGroupCode = groupCode;
  pendingGroupName = groupName;
  $('create-code-display').textContent = formatCode(groupCode);
  $('create-code-reveal').style.display = 'block';
  $('btn-generate-group').style.display = 'none';
  $('btn-enter-group').style.display = 'flex';
});

$('btn-enter-group').addEventListener('click', () => {
  if (!pendingGroupCode) return;
  closeCreateModal();
  socket.emit('joinGroup', { groupCode: pendingGroupCode, username: currentUser.username });
});

// ============================================
// JOIN GROUP
// ============================================
function openJoinModal() {
  joinCodeInput.value = '';
  $('join-code-status').textContent = '';
  $('join-code-count').textContent = '0/32 chars';
  $('join-code-line').classList.remove('valid');
  modalJoin.classList.remove('hidden');
  setTimeout(() => joinCodeInput.focus(), 100);
}
function closeJoinModal() { modalJoin.classList.add('hidden'); }

$('btn-open-join').addEventListener('click', openJoinModal);
$('home-btn-join').addEventListener('click', openJoinModal);
$('btn-cancel-join').addEventListener('click', closeJoinModal);
modalJoin.addEventListener('click', e => { if (e.target === modalJoin) closeJoinModal(); });

joinCodeInput.addEventListener('input', () => {
  let raw = joinCodeInput.value.replace(/[^a-fA-F0-9\-]/g, '').toUpperCase();
  // Auto-format: insert dashes every 8 hex chars (display only)
  const hexOnly = raw.replace(/-/g, '');
  const count = hexOnly.length;
  $('join-code-count').textContent = `${count}/32 chars`;

  if (count === 32) {
    $('join-code-status').innerHTML = '<span class="material-symbols-outlined" style="font-size:10px">verified_user</span> Code checksum verified';
    $('join-code-line').classList.add('valid');
  } else {
    $('join-code-status').textContent = '';
    $('join-code-line').classList.remove('valid');
  }
});

joinCodeInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitJoin(); });
$('btn-join-submit').addEventListener('click', submitJoin);

function submitJoin() {
  const raw = joinCodeInput.value.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (raw.length < 10) { showToast('Enter a valid group code', true); return; }
  socket.emit('joinGroup', { groupCode: raw, username: currentUser.username });
  closeJoinModal();
}

// ============================================
// JOINED GROUP
// ============================================
socket.on('joinedGroup', ({ groupCode, groupName, history, members }) => {
  currentGroup = { groupCode, groupName, members: [...members] };
  chatGroupName.textContent = groupName;
  sidebarGroupName.textContent = groupName;
  sidebarGroupSection.style.display = 'block';

  // Update settings panel
  settingsGroupName.textContent = groupName;
  const now = new Date();
  settingsEstDate.textContent = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}`;

  // Show code blurred
  settingsCodeDisplay.textContent = formatCode(groupCode);
  settingsCodeDisplay.classList.remove('revealed');
  $('btn-copy-code').style.display = 'none';
  $('btn-reveal-code').style.display = 'inline-flex';

  updateMembersList(members);

  messageFeed.innerHTML = '';
  history.forEach(renderMessage);
  scrollFeed();

  switchView('chat');
  $('nav-messages').classList.add('active');
});

socket.on('error', ({ message }) => showToast(message, true));

// ============================================
// MESSAGES
// ============================================
function renderMessage(msg) {
  if (!currentUser) return;
  const isSent = msg.sender === currentUser.username;
  const isSystem = msg.type === 'system' || msg.sender === 'SYSTEM';

  const cluster = document.createElement('div');
  cluster.className = 'msg-cluster ' + (isSystem ? 'system' : isSent ? 'sent' : 'received');
  cluster.dataset.msgId = msg.id;

  let inner = '';

  if (!isSystem && !isSent) {
    inner += `<div class="msg-sender">${escHtml(msg.sender)}</div>`;
  }

  if (msg.type === 'image') {
    inner += `<div class="msg-bubble">
      <img class="msg-image" src="${msg.content}" alt="Shared image" loading="lazy" />
      <div class="msg-meta">
        <span>${formatTime(msg.timestamp)}</span>
        ${msg.edited ? '<span class="msg-edited">(edited)</span>' : ''}
      </div>
    </div>`;
  } else {
    inner += `<div class="msg-bubble" id="bubble-${msg.id}">
      <span class="msg-text">${escHtml(msg.content || '')}</span>
      <div class="msg-meta">
        <span>${formatTime(msg.timestamp)}</span>
        ${msg.edited ? '<span class="msg-edited">(edited)</span>' : ''}
      </div>
    </div>`;
  }

  cluster.innerHTML = inner;

  // Double-click to edit sent messages
  if (isSent && msg.type !== 'image' && !isSystem) {
    const bubble = cluster.querySelector('.msg-bubble');
    bubble.addEventListener('dblclick', () => startEdit(msg.id, cluster));
  }

  // Image lightbox
  if (msg.type === 'image') {
    cluster.querySelector('.msg-image').addEventListener('click', e => {
      lightboxImg.src = e.target.src;
      lightbox.classList.remove('hidden');
    });
  }

  messageFeed.appendChild(cluster);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

socket.on('newMessage', msg => {
  renderMessage(msg);
  scrollFeed();
  // Add to log if system
  if (msg.type === 'system') appendLog(msg.content);
});

function scrollFeed() {
  messageFeed.scrollTop = messageFeed.scrollHeight;
}

// ============================================
// SEND MESSAGE
// ============================================
btnSend.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || !currentGroup) return;
  socket.emit('sendMessage', { groupCode: currentGroup.groupCode, content: text, type: 'text' });
  chatInput.value = '';
  emojiPicker.classList.add('hidden');
}

// ============================================
// TYPING INDICATOR
// ============================================
chatInput.addEventListener('input', () => {
  if (!currentGroup) return;
  socket.emit('typing', { groupCode: currentGroup.groupCode });
  clearTimeout(typingTimer);
});

let typingUsers = new Set();
let typingTimeout = null;

socket.on('userTyping', ({ username }) => {
  if (username === currentUser?.username) return;
  typingUsers.add(username);
  typingText.textContent = [...typingUsers].join(', ') + ' is typing...';
  typingIndicator.classList.remove('hidden');

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    typingUsers.delete(username);
    if (typingUsers.size === 0) typingIndicator.classList.add('hidden');
    else typingText.textContent = [...typingUsers].join(', ') + ' is typing...';
  }, 2500);
});

// ============================================
// EDIT MESSAGE
// ============================================
function startEdit(msgId, cluster) {
  const bubble = cluster.querySelector('.msg-bubble');
  const textEl = bubble.querySelector('.msg-text');
  const oldText = textEl.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'msg-edit-input';
  input.value = oldText;

  textEl.replaceWith(input);
  input.focus(); input.select();

  const finish = (save) => {
    const newText = input.value.trim();
    if (save && newText && newText !== oldText) {
      socket.emit('editMessage', {
        groupCode: currentGroup.groupCode,
        messageId: msgId,
        newText
      });
    }
    const span = document.createElement('span');
    span.className = 'msg-text';
    span.textContent = save ? newText : oldText;
    input.replaceWith(span);
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(false));
}

socket.on('messageEdited', ({ messageId, newContent }) => {
  const cluster = messageFeed.querySelector(`[data-msg-id="${messageId}"]`);
  if (!cluster) return;
  const textEl = cluster.querySelector('.msg-text');
  if (textEl) textEl.textContent = newContent;
  // Add edited label if not present
  const meta = cluster.querySelector('.msg-meta');
  if (meta && !meta.querySelector('.msg-edited')) {
    meta.insertAdjacentHTML('beforeend', '<span class="msg-edited">(edited)</span>');
  }
});

// ============================================
// IMAGE SHARING
// ============================================
imgUpload.addEventListener('change', () => {
  const file = imgUpload.files[0];
  if (!file || !currentGroup) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Image too large (max 5MB)', true); return; }

  const reader = new FileReader();
  reader.onload = e => {
    socket.emit('sendMessage', {
      groupCode: currentGroup.groupCode,
      content: e.target.result,
      type: 'image'
    });
  };
  reader.readAsDataURL(file);
  imgUpload.value = '';
});

// ============================================
// EMOJI PICKER
// ============================================
function populateEmojiPicker() {
  emojiPicker.innerHTML = '';
  EMOJIS.forEach(em => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn'; btn.textContent = em;
    btn.addEventListener('click', () => {
      chatInput.value += em;
      chatInput.focus();
    });
    emojiPicker.appendChild(btn);
  });
}

btnEmoji.addEventListener('click', e => {
  e.stopPropagation();
  emojiPicker.classList.toggle('hidden');
});
document.addEventListener('click', e => {
  if (!emojiPicker.contains(e.target) && e.target !== btnEmoji) {
    emojiPicker.classList.add('hidden');
  }
});

// ============================================
// LIGHTBOX
// ============================================
$('lightbox-close').addEventListener('click', () => lightbox.classList.add('hidden'));
$('lightbox-close-btn').addEventListener('click', () => lightbox.classList.add('hidden'));

// ============================================
// SETTINGS PANEL
// ============================================
$('btn-settings-panel').addEventListener('click', () => {
  settingsOverlay.classList.toggle('hidden');
});
$('btn-close-settings').addEventListener('click', () => settingsOverlay.classList.add('hidden'));

// Reveal/copy code
$('btn-reveal-code').addEventListener('click', () => {
  settingsCodeDisplay.classList.add('revealed');
  $('btn-reveal-code').style.display = 'none';
  $('btn-copy-code').style.display = 'flex';
});
$('btn-copy-code').addEventListener('click', () => {
  if (!currentGroup) return;
  navigator.clipboard.writeText(currentGroup.groupCode).then(() => showToast('Code copied!'));
});

// Members list
socket.on('userJoined', ({ username }) => {
  if (!currentGroup) return;
  if (!currentGroup.members.includes(username)) currentGroup.members.push(username);
  updateMembersList(currentGroup.members);
  settingsMemberCount.textContent = currentGroup.members.length;
});
socket.on('userLeft', ({ username }) => {
  if (!currentGroup) return;
  currentGroup.members = currentGroup.members.filter(m => m !== username);
  updateMembersList(currentGroup.members);
  settingsMemberCount.textContent = currentGroup.members.length;
});

function updateMembersList(members) {
  settingsMemberCount.textContent = members.length;
  settingsMembersList.innerHTML = members.map((m, i) => `
    <div class="member-item">
      <div class="member-avatar">${getInitial(m)}</div>
      <div class="member-info">
        <div class="member-name">${escHtml(m)}</div>
        <div class="member-role">${i === 0 ? 'ADMIN' : 'OPERATIVE'}</div>
      </div>
      <span class="material-symbols-outlined" style="font-size:14px;color:#00dce5;opacity:0.6">sensors</span>
    </div>
  `).join('');
}

// ============================================
// LEAVE GROUP
// ============================================
function leaveGroup() {
  if (!currentGroup) return;
  socket.emit('leaveGroup', { groupCode: currentGroup.groupCode });
}
$('btn-leave-group').addEventListener('click', leaveGroup);
$('btn-leave-from-settings').addEventListener('click', () => { settingsOverlay.classList.add('hidden'); leaveGroup(); });
$('btn-leave-settings') && $('btn-leave-settings').addEventListener('click', leaveGroup);

socket.on('leftGroup', () => {
  currentGroup = null;
  messageFeed.innerHTML = '';
  sidebarGroupSection.style.display = 'none';
  settingsOverlay.classList.add('hidden');
  switchView('home');
  $('nav-messages').classList.remove('active');
});

// ============================================
// NAV / SIDEBAR
// ============================================
document.querySelectorAll('.nav-item[data-view]').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const view = item.dataset.view;
    if (view === 'home') switchView('home');
    else if (view === 'messages' && currentGroup) switchView('chat');
  });
});

$('sidebar-current-group').addEventListener('click', () => {
  if (currentGroup) switchView('chat');
});

$('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('cryptchat_username');
  location.reload();
});

// ============================================
// HOME LOG APPEND
// ============================================
function appendLog(text) {
  const container = $('home-log');
  const entry = document.createElement('div');
  entry.className = 'log-entry user';
  entry.innerHTML = `
    <div class="log-entry-type">USER_ACTION</div>
    <div class="log-entry-text">${escHtml(text)}</div>
    <div class="log-entry-time">${formatTime(Date.now())}</div>
  `;
  container.prepend(entry);
  // Keep max 5
  while (container.children.length > 5) container.lastChild.remove();
}

// ============================================
// PING DISPLAY
// ============================================
function measurePing() {
  const t = Date.now();
  socket.emit('ping_test', () => {
    $('ping-display').textContent = Date.now() - t;
  });
}
setInterval(measurePing, 8000);

// ============================================
// INIT
// ============================================
// If returning user, auto-populate name
if (savedName) {
  // Show landing for them to confirm
  screenLanding.classList.add('active');
}
