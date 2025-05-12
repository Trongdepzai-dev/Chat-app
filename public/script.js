const socket = io();
let currentUser = null;
let currentChat = 'public';
let conversations = { public: [] };
let friends = [];
let friendRequests = [];

function togglePassword(inputId) {
  const input = document.getElementById(inputId);
  const icon = input.nextElementSibling.querySelector('i');
  if (input.type === 'password') {
    input.type = 'text';
    icon.classList.remove('fa-eye');
    icon.classList.add('fa-eye-slash');
  } else {
    input.type = 'password';
    icon.classList.remove('fa-eye-slash');
    icon.classList.add('fa-eye');
  }
}

document.getElementById('loginTab').addEventListener('click', () => {
  document.getElementById('loginForm').classList.remove('hidden');
  document.getElementById('registerForm').classList.add('hidden');
  document.getElementById('loginTab').classList.add('tab-active', 'text-primary-600', 'border-primary-600');
  document.getElementById('registerTab').classList.remove('tab-active', 'text-primary-600', 'border-primary-600');
  document.getElementById('registerTab').classList.add('text-gray-500');
});

document.getElementById('registerTab').addEventListener('click', () => {
  document.getElementById('registerForm').classList.remove('hidden');
  document.getElementById('loginForm').classList.add('hidden');
  document.getElementById('registerTab').classList.add('tab-active', 'text-primary-600', 'border-primary-600');
  document.getElementById('loginTab').classList.remove('tab-active', 'text-primary-600', 'border-primary-600');
  document.getElementById('loginTab').classList.add('text-gray-500');
});

document.getElementById('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;
  socket.emit('login', { username, password });
});

document.getElementById('registerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const username = document.getElementById('registerUsername').value;
  const password = document.getElementById('registerPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  if (password !== confirmPassword) {
    alert('Passwords do not match');
    return;
  }
  socket.emit('register', { username, password });
});

document.getElementById('logoutButton').addEventListener('submit', (e) => {
  e.preventDefault();
  socket.emit('logout');
  currentUser = null;
  document.getElementById('chatSection').classList.add('hidden');
  document.getElementById('authSection').classList.remove('hidden');
});

document.getElementById('messageForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const message = document.getElementById('messageInput').value;
  if (message.trim()) {
    socket.emit('message', { chat: currentChat, message });
    document.getElementById('messageInput').value = '';
  }
});

document.getElementById('searchInput').addEventListener('input', (e) => {
  const query = e.target.value;
  socket.emit('searchUsers', query);
});

document.getElementById('banForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const userId = document.getElementById('banUserId').value;
  const duration = document.getElementById('banDuration').value;
  socket.emit('banUser', { userId, duration: parseInt(duration) });
  closeModal();
});

socket.on('loginSuccess', (user) => {
  currentUser = user;
  document.getElementById('authSection').classList.add('hidden');
  document.getElementById('chatSection').classList.remove('hidden');
  document.getElementById('welcomeMessage').textContent = `Welcome, ${user.username}${user.isAdmin ? ' (Admin)' : ''}`;
  if (user.isAdmin) {
    document.getElementById('adminControls').classList.remove('hidden');
  }
  socket.emit('getConversations');
});

socket.on('loginFailure', (message) => {
  alert(message);
});

socket.on('registerSuccess', () => {
  alert('Registration successful. Please login.');
  document.getElementById('loginTab').click();
});

socket.on('registerFailure', (message) => {
  alert(message);
});

socket.on('message', ({ chat, message, user }) => {
  if (!conversations[chat]) conversations[chat] = [];
  conversations[chat].push({ user, message });
  if (chat === currentChat) {
    const className = user.id === currentUser.id ? 'user' : 'other';
    const adminTag = user.isAdmin ? '<span class="ml-2 friend-tag">Admin</span>' : '';
    const friendTag = friends.some(f => f.id === user.id) ? '<span class="ml-2 friend-tag">Friend</span>' : '';
    addMessageWithAnimation(`<strong>${user.username}${adminTag}${friendTag}:</strong> ${message}`, className);
  }
  updateContactList();
});

socket.on('searchResults', (users) => {
  const searchResults = document.getElementById('searchResults');
  searchResults.innerHTML = '';
  users.forEach(user => {
    if (user.id !== currentUser.id) {
      const div = document.createElement('div');
      div.className = 'p-2 bg-white/50 rounded-lg contact-item';
      div.style = `--order: ${users.indexOf(user)}`;
      const adminTag = user.isAdmin ? '<span class="ml-2 friend-tag">Admin</span>' : '';
      const friendTag = friends.some(f => f.id === user.id) ? '<span class="ml-2 friend-tag">Friend</span>' : '';
      const isFriend = friends.some(f => f.id === user.id);
      div.innerHTML = `
        ${user.username}${adminTag}${friendTag}
        <button onclick="sendFriendRequest(${user.id})" class="${isFriend ? 'hidden' : ''} ml-2 bg-primary-600 text-white px-2 py-1 rounded-lg btn-hover-grow">
          <i class="fas fa-user-plus"></i> Add Friend
        </button>
        <button onclick="startChat(${user.id})" class="${isFriend ? '' : 'hidden'} ml-2 bg-secondary-600 text-white px-2 py-1 rounded-lg btn-hover-grow">
          <i class="fas fa-comment"></i> Message
        </button>
      `;
      searchResults.appendChild(div);
    }
  });
});

socket.on('friendRequest', (request) => {
  friendRequests.push(request);
  updateContactList();
});

socket.on('friendRequestAccepted', ({ friend, chatId }) => {
  friends.push(friend);
  conversations[chatId] = [];
  updateContactList();
});

socket.on('conversations', (data) => {
  conversations = { public: data.public || [] };
  friends = data.friends || [];
  friendRequests = data.friendRequests || [];
  Object.keys(data.private || {}).forEach(chatId => {
    conversations[chatId] = data.private[chatId];
  });
  updateContactList();
  if (currentChat === 'public') {
    displayMessages('public');
  }
});

socket.on('banSuccess', (message) => {
  alert(message);
});

socket.on('banFailure', (message) => {
  alert(message);
});

socket.on('userBanned', () => {
  alert('You have been banned.');
  socket.emit('logout');
});

socket.on('exportUsers', (csv) => {
  document.getElementById('exportContent').textContent = csv;
  document.getElementById('exportModal').classList.remove('hidden');
});

function sendFriendRequest(userId) {
  socket.emit('friendRequest', userId);
}

function acceptFriendRequest(requestId) {
  socket.emit('acceptFriendRequest', requestId);
}

function rejectFriendRequest(requestId) {
  socket.emit('rejectFriendRequest', requestId);
}

function startChat(userId) {
  const friend = friends.find(f => f.id === userId);
  if (friend) {
    if (friend.chatId) {
      switchChat(friend.chatId);
    } else {
      socket.emit('startChat', userId);
    }
  }
}

function switchChat(chatId) {
  currentChat = chatId;
  document.getElementById('chatTitle').textContent = chatId === 'public' ? 'Public' : friends.find(f => f.chatId === chatId)?.username || 'Private';
  document.getElementById('chatBox').innerHTML = '';
  displayMessages(chatId);
  updateContactList();
}

function displayMessages(chatId) {
  const messages = conversations[chatId] || [];
  messages.forEach(({ user, message }) => {
    const className = user.id === currentUser.id ? 'user' : 'other';
    const adminTag = user.isAdmin ? '<span class="ml-2 friend-tag">Admin</span>' : '';
    const friendTag = friends.some(f => f.id === user.id) ? '<span class="ml-2 friend-tag">Friend</span>' : '';
    addMessageWithAnimation(`<strong>${user.username}${adminTag}${friendTag}:</strong> ${message}`, className);
  });
}

function updateContactList() {
  const contactList = document.getElementById('contactList');
  contactList.innerHTML = '';
  
  const publicItem = document.createElement('div');
  publicItem.className = `p-2 rounded-lg contact-item ${currentChat === 'public' ? 'active' : ''}`;
  publicItem.style = '--order: 0';
  publicItem.innerHTML = '<strong>Public Chat</strong>';
  publicItem.onclick = () => switchChat('public');
  contactList.appendChild(publicItem);
  
  friendRequests.forEach((request, index) => {
    const div = document.createElement('div');
    div.className = 'p-2 bg-white/50 rounded-lg contact-item';
    div.style = `--order: ${index + 1}`;
    div.innerHTML = `
      Friend Request from ${request.fromUsername}
      <button onclick="acceptFriendRequest(${request.id})" class="ml-2 bg-secondary-600 text-white px-2 py-1 rounded-lg btn-hover-grow">
        <i class="fas fa-check"></i> Accept
      </button>
      <button onclick="rejectFriendRequest(${request.id})" class="ml-2 bg-danger-600 text-white px-2 py-1 rounded-lg btn-hover-grow">
        <i class="fas fa-times"></i> Reject
      </button>
    `;
    contactList.appendChild(div);
  });
  
  friends.forEach((friend, index) => {
    const div = document.createElement('div');
    div.className = `p-2 rounded-lg contact-item ${currentChat === friend.chatId ? 'active' : ''}`;
    div.style = `--order: ${index + friendRequests.length + 1}`;
    const adminTag = friend.isAdmin ? '<span class="ml-2 friend-tag">Admin</span>' : '';
    const friendTag = '<span class="ml-2 friend-tag">Friend</span>';
    div.innerHTML = `${friend.username}${adminTag}${friendTag}`;
    div.onclick = () => switchChat(friend.chatId);
    contactList.appendChild(div);
  });
}

function exportUsers() {
  socket.emit('exportUsers');
}

function openBanModal() {
  document.getElementById('banModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('banModal').classList.add('hidden');
}

function closeExportModal() {
  document.getElementById('exportModal').classList.add('hidden');
}