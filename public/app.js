// Global State
let currentConfig = null;
let currentPath = '/home/ubuntu';
let terminal = null;
let fitAddon = null;
let termSocket = null;
let currentEditingFile = null;

// DOM Elements
const loginOverlay = document.getElementById('loginOverlay');
const loginForm = document.getElementById('loginForm');
const loginFeedback = document.getElementById('loginFeedback');
const btnLoginSubmit = document.getElementById('btnLoginSubmit');

const tabs = document.querySelectorAll('.nav-item');
const tabPanes = document.querySelectorAll('.tab-pane');
const pageTitle = document.getElementById('pageTitle');
const pageSubtitle = document.getElementById('pageSubtitle');
const statusIndicator = document.getElementById('statusIndicator');
const statusTitle = document.getElementById('statusTitle');
const statusSubtitle = document.getElementById('statusSubtitle');
const activeUserBadge = document.getElementById('activeUserBadge');

// Notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? 'circle-check' : type === 'error' ? 'circle-exclamation' : 'circle-info';
  toast.innerHTML = `<i class="fa-solid fa-${icon}"></i><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// === LOGIN FORM LOGIC ===

// Toggle Login Auth Type
document.querySelectorAll('input[name="loginAuthType"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    if (e.target.value === 'key') {
      document.getElementById('loginSectionKey').style.display = 'block';
      document.getElementById('loginSectionPass').style.display = 'none';
    } else {
      document.getElementById('loginSectionPass').style.display = 'block';
      document.getElementById('loginSectionKey').style.display = 'none';
    }
  });
});

// Toggle Login Password Visibility
document.getElementById('btnLoginTogglePass').addEventListener('click', () => {
  const pwd = document.getElementById('loginPassword');
  const icon = document.querySelector('#btnLoginTogglePass i');
  if (pwd.type === 'password') {
    pwd.type = 'text';
    icon.classList.replace('fa-eye', 'fa-eye-slash');
  } else {
    pwd.type = 'password';
    icon.classList.replace('fa-eye-slash', 'fa-eye');
  }
});

// Populate Login Form with saved credentials in localStorage or config
function populateLoginForm(profile) {
  const saved = localStorage.getItem('vps_saved_login');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      if (data.host) document.getElementById('loginHost').value = data.host;
      if (data.port) document.getElementById('loginPort').value = data.port;
      if (data.username) document.getElementById('loginUser').value = data.username;
      if (data.authType === 'key') {
        document.getElementById('loginAuthKey').checked = true;
        document.getElementById('loginSectionKey').style.display = 'block';
        document.getElementById('loginSectionPass').style.display = 'none';
        if (data.privateKeyPath) document.getElementById('loginKeyPath').value = data.privateKeyPath;
      }
    } catch (e) {}
  }
}

// Handle Login Form Submission
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginFeedback.style.display = 'none';
  btnLoginSubmit.disabled = true;
  btnLoginSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating with VPS...';

  const authType = document.querySelector('input[name="loginAuthType"]:checked').value;
  const host = document.getElementById('loginHost').value.trim();
  const port = parseInt(document.getElementById('loginPort').value.trim()) || 22;
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPassword').value;
  const privateKeyPath = document.getElementById('loginKeyPath').value.trim();
  const passphrase = document.getElementById('loginPassphrase').value;
  const remember = document.getElementById('loginRemember').checked;

  const credentials = {
    host,
    port,
    username,
    authType,
    password,
    privateKeyPath,
    passphrase,
    defaultPath: '/home/' + username
  };

  try {
    // 1. Submit login to server (creates active in-memory session)
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    const data = await res.json();

    if (!data.success) {
      loginFeedback.className = 'login-feedback error';
      loginFeedback.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${data.error}`;
      loginFeedback.style.display = 'flex';
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Connect & Open Dashboard';
      return;
    }

    // 2. Remember in browser localStorage only (if user checked it)
    if (remember) {
      localStorage.setItem('vps_saved_login', JSON.stringify({ host, port, username, authType, privateKeyPath }));
    } else {
      localStorage.removeItem('vps_saved_login');
    }

    // 3. Update active session UI
    loginFeedback.className = 'login-feedback success';
    loginFeedback.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${data.message}`;
    loginFeedback.style.display = 'flex';

    setTimeout(() => {
      // Hide Login Overlay
      loginOverlay.classList.add('hidden');
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Connect & Open Dashboard';

      // Update Dashboard Topbar & Sidebar
      statusSubtitle.textContent = `${username}@${host}`;
      activeUserBadge.textContent = `${username}@${host}`;
      statusIndicator.className = 'status-indicator online';
      statusTitle.textContent = 'Online & Connected';

      currentPath = data.defaultPath || ('/home/' + username);
      document.getElementById('sftpCurrentPath').value = currentPath;

      // Populate Settings tab form
      populateSettingsForm(credentials);

      // Start services
      initTerminal();
      loadDirectory(currentPath);
      fetchServerStats();
      showToast(`Logged in to ${username}@${host}`, 'success');
    }, 400);

  } catch (err) {
    loginFeedback.className = 'login-feedback error';
    loginFeedback.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Network error: ${err.message}`;
    loginFeedback.style.display = 'flex';
    btnLoginSubmit.disabled = false;
    btnLoginSubmit.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Connect & Open Dashboard';
  }
});

// Logout / Switch Server Action
async function logoutToLoginScreen() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {}

  if (termSocket) {
    termSocket.close();
  }
  if (terminal) {
    terminal.clear();
  }
  loginFeedback.style.display = 'none';
  document.getElementById('loginPassword').value = '';
  loginOverlay.classList.remove('hidden');
  showToast('Logged out of VPS session', 'info');
}

document.getElementById('btnSidebarLogout').addEventListener('click', logoutToLoginScreen);
document.getElementById('btnHeaderLogout').addEventListener('click', logoutToLoginScreen);

// === TAB SWITCHING ===
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const targetTab = tab.getAttribute('data-tab');
    tabs.forEach(t => t.classList.remove('active'));
    tabPanes.forEach(p => p.classList.remove('active'));

    tab.classList.add('active');
    document.getElementById(targetTab).classList.add('active');

    // Update Header
    if (targetTab === 'tab-terminal') {
      pageTitle.textContent = 'Live Terminal';
      pageSubtitle.textContent = 'Direct interactive SSH shell to your Ubuntu VPS';
      if (fitAddon) setTimeout(() => fitAddon.fit(), 100);
    } else if (targetTab === 'tab-sftp') {
      pageTitle.textContent = 'SFTP File Explorer';
      pageSubtitle.textContent = 'Browse, upload, download, and edit files on your server';
      loadDirectory(currentPath);
    } else if (targetTab === 'tab-commands') {
      pageTitle.textContent = 'Quick Commands';
      pageSubtitle.textContent = 'Execute one-off scripts and saved diagnostic presets';
    } else if (targetTab === 'tab-stats') {
      pageTitle.textContent = 'System Metrics';
      pageSubtitle.textContent = 'Live resource utilization overview for your VPS';
      fetchServerStats();
    } else if (targetTab === 'tab-settings') {
      pageTitle.textContent = 'Connection Profile';
      pageSubtitle.textContent = 'Manage SSH host credentials and authentication keys';
    }
  });
});

// Load Configuration from Backend
async function fetchConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data.success) {
      currentConfig = data;
      renderQuickCommands(data.quickCommands || []);
    }

    // Check if session is already active
    const statusRes = await fetch('/api/auth/status');
    const statusData = await statusRes.json();
    if (statusData.isLoggedIn) {
      loginOverlay.classList.add('hidden');
      statusSubtitle.textContent = `${statusData.user}@${statusData.host}`;
      activeUserBadge.textContent = `${statusData.user}@${statusData.host}`;
      statusIndicator.className = 'status-indicator online';
      statusTitle.textContent = 'Online & Connected';
      currentPath = statusData.defaultPath || '/home/' + statusData.user;
      document.getElementById('sftpCurrentPath').value = currentPath;
      initTerminal();
      loadDirectory(currentPath);
      fetchServerStats();
    } else {
      populateLoginForm();
    }
  } catch (err) {
    console.error('Failed to load configuration:', err);
    populateLoginForm();
  }
}

// Populate Settings Form
function populateSettingsForm(profile) {
  if (!profile) return;
  document.getElementById('cfgHost').value = profile.host || '';
  document.getElementById('cfgPort').value = profile.port || 22;
  document.getElementById('cfgUser').value = profile.username || 'ubuntu';
  document.getElementById('cfgDefaultPath').value = profile.defaultPath || '/home/ubuntu';

  const authType = profile.authType || 'password';
  if (authType === 'key') {
    document.getElementById('authTypeKey').checked = true;
    document.getElementById('sectionKey').style.display = 'block';
    document.getElementById('sectionPass').style.display = 'none';
  } else {
    document.getElementById('authTypePass').checked = true;
    document.getElementById('sectionPass').style.display = 'block';
    document.getElementById('sectionKey').style.display = 'none';
  }

  document.getElementById('cfgPassword').value = profile.hasPassword ? '••••••••' : '';
  document.getElementById('cfgKeyPath').value = profile.privateKeyPath || '';
  document.getElementById('cfgPassphrase').value = profile.passphrase || '';
}

// Toggle Auth Method in Settings
document.querySelectorAll('input[name="authType"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    if (e.target.value === 'key') {
      document.getElementById('sectionKey').style.display = 'block';
      document.getElementById('sectionPass').style.display = 'none';
    } else {
      document.getElementById('sectionPass').style.display = 'block';
      document.getElementById('sectionKey').style.display = 'none';
    }
  });
});

// Toggle Settings Password visibility
document.getElementById('btnTogglePass').addEventListener('click', () => {
  const pwd = document.getElementById('cfgPassword');
  const icon = document.querySelector('#btnTogglePass i');
  if (pwd.type === 'password') {
    pwd.type = 'text';
    icon.classList.replace('fa-eye', 'fa-eye-slash');
  } else {
    pwd.type = 'password';
    icon.classList.replace('fa-eye-slash', 'fa-eye');
  }
});

// Test Connection Button in Settings
document.getElementById('btnTestConfig').addEventListener('click', async () => {
  const resultBox = document.getElementById('testResultBox');
  resultBox.style.display = 'block';
  resultBox.className = 'test-result-box';
  resultBox.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting to VPS...';

  const profile = getFormProfileData();
  try {
    const res = await fetch('/api/config/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, profileId: 'default' })
    });
    const data = await res.json();
    if (data.success) {
      resultBox.className = 'test-result-box success';
      resultBox.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${data.message}`;
      showToast('Connection verified!', 'success');
    } else {
      resultBox.className = 'test-result-box error';
      resultBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${data.error}`;
      showToast('Connection failed: ' + data.error, 'error');
    }
  } catch (err) {
    resultBox.className = 'test-result-box error';
    resultBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Network error: ${err.message}`;
  }
});

document.getElementById('btnQuickTest').addEventListener('click', async () => {
  showToast('Testing VPS connection...', 'info');
  try {
    const res = await fetch('/api/config/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json();
    if (data.success) {
      statusIndicator.className = 'status-indicator online';
      statusTitle.textContent = 'Online & Ready';
      showToast('Connection active!', 'success');
    } else {
      statusIndicator.className = 'status-indicator offline';
      statusTitle.textContent = 'Offline';
      showToast('Connection failed: ' + data.error, 'error');
    }
  } catch (e) {
    statusIndicator.className = 'status-indicator offline';
  }
});

function getFormProfileData() {
  const authType = document.querySelector('input[name="authType"]:checked').value;
  return {
    host: document.getElementById('cfgHost').value.trim(),
    port: parseInt(document.getElementById('cfgPort').value.trim()) || 22,
    username: document.getElementById('cfgUser').value.trim(),
    defaultPath: document.getElementById('cfgDefaultPath').value.trim() || '/home/ubuntu',
    authType,
    password: document.getElementById('cfgPassword').value,
    privateKeyPath: document.getElementById('cfgKeyPath').value.trim(),
    passphrase: document.getElementById('cfgPassphrase').value
  };
}

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const profile = getFormProfileData();

  try {
    const res = await fetch('/api/config/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'default', profile, makeActive: true })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Settings saved successfully!', 'success');
      fetchConfig();
      initTerminal();
    } else {
      showToast('Failed to save settings: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('Network error saving settings', 'error');
  }
});

// === INTERACTIVE XTERM.JS TERMINAL ===
function initTerminal() {
  const container = document.getElementById('terminal-container');
  container.innerHTML = '';

  if (typeof Terminal === 'undefined') {
    container.innerHTML = '<div style="color:#ef4444; padding:20px;">Terminal library failed to load. Check internet connection.</div>';
    return;
  }

  terminal = new Terminal({
    cursorBlink: true,
    fontFamily: '"JetBrains Mono", Consolas, monospace',
    fontSize: 14,
    theme: {
      background: '#000000',
      foreground: '#f1f5f9',
      cursor: '#38bdf8',
      selectionBackground: 'rgba(56, 189, 248, 0.3)',
      black: '#000000',
      red: '#ef4444',
      green: '#10b981',
      yellow: '#f59e0b',
      blue: '#3b82f6',
      magenta: '#a855f7',
      cyan: '#06b6d4',
      white: '#f1f5f9'
    }
  });

  if (typeof FitAddon !== 'undefined') {
    fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);
  }

  terminal.open(container);
  if (fitAddon) fitAddon.fit();

  connectTerminalWebSocket();
}

function connectTerminalWebSocket() {
  if (termSocket) {
    termSocket.close();
  }

  const dot = document.getElementById('terminalDot');
  const statusTxt = document.getElementById('terminalStatusText');
  dot.className = 'pulse-dot';
  statusTxt.textContent = 'Connecting...';

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/terminal`;
  termSocket = new WebSocket(wsUrl);

  termSocket.onopen = () => {
    const cols = terminal.cols || 80;
    const rows = terminal.rows || 24;
    termSocket.send(JSON.stringify({ type: 'init', cols, rows }));
  };

  termSocket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'data') {
        terminal.write(msg.data);
      } else if (msg.type === 'connected') {
        dot.className = 'pulse-dot online';
        statusTxt.textContent = msg.message;
      } else if (msg.type === 'error') {
        dot.className = 'pulse-dot offline';
        statusTxt.textContent = 'Error';
        terminal.writeln(`\r\n\x1b[31m[SSH ERROR] ${msg.message}\x1b[0m\r\n`);
      } else if (msg.type === 'close') {
        dot.className = 'pulse-dot offline';
        statusTxt.textContent = 'Disconnected';
        terminal.writeln(`\r\n\x1b[33m[SSH DISCONNECTED]\x1b[0m\r\n`);
      }
    } catch (e) {
      terminal.write(event.data);
    }
  };

  termSocket.onclose = () => {
    dot.className = 'pulse-dot offline';
    statusTxt.textContent = 'Disconnected';
  };

  terminal.onData((data) => {
    if (termSocket && termSocket.readyState === WebSocket.OPEN) {
      termSocket.send(JSON.stringify({ type: 'input', data }));
    }
  });

  terminal.onResize((size) => {
    if (termSocket && termSocket.readyState === WebSocket.OPEN) {
      termSocket.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
    }
  });
}

// Terminal Actions
document.getElementById('btnTermClear').addEventListener('click', () => {
  if (terminal) terminal.clear();
});

document.getElementById('btnTermCtrlC').addEventListener('click', () => {
  if (termSocket && termSocket.readyState === WebSocket.OPEN) {
    termSocket.send(JSON.stringify({ type: 'input', data: '\x03' }));
  }
});

document.getElementById('btnTermReconnect').addEventListener('click', () => {
  terminal.reset();
  connectTerminalWebSocket();
});

document.getElementById('btnHeaderConnect').addEventListener('click', () => {
  initTerminal();
  showToast('Reconnecting SSH terminal...', 'info');
});

window.addEventListener('resize', () => {
  if (fitAddon) fitAddon.fit();
});

// === SFTP FILE EXPLORER ===

async function loadDirectory(path) {
  const tbody = document.getElementById('sftpFilesBody');
  tbody.innerHTML = `
    <tr>
      <td colspan="6" class="loading-cell">
        <i class="fa-solid fa-spinner fa-spin"></i> Loading directory ${path}...
      </td>
    </tr>
  `;

  try {
    const res = await fetch(`/api/sftp/list?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    if (!data.success) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="loading-cell" style="color:var(--danger)">
            <i class="fa-solid fa-triangle-exclamation"></i> Error: ${data.error}
          </td>
        </tr>
      `;
      return;
    }

    currentPath = data.path;
    document.getElementById('sftpCurrentPath').value = currentPath;
    renderFileList(data.items);
  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="loading-cell" style="color:var(--danger)">
          <i class="fa-solid fa-triangle-exclamation"></i> Network error loading directory: ${err.message}
        </td>
      </tr>
    `;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(item) {
  if (item.isDir) return '<i class="fa-solid fa-folder file-icon folder"></i>';
  const ext = item.name.split('.').pop().toLowerCase();
  if (['js', 'ts', 'py', 'json', 'html', 'css', 'sh', 'php', 'c', 'cpp', 'rs', 'go', 'yml', 'yaml', 'env'].includes(ext)) {
    return '<i class="fa-solid fa-file-code file-icon code"></i>';
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) {
    return '<i class="fa-solid fa-file-image file-icon image"></i>';
  }
  if (['zip', 'tar', 'gz', 'bz2', '7z', 'rar'].includes(ext)) {
    return '<i class="fa-solid fa-file-zipper file-icon zip"></i>';
  }
  return '<i class="fa-regular fa-file-lines file-icon text"></i>';
}

function renderFileList(items) {
  const tbody = document.getElementById('sftpFilesBody');
  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="loading-cell" style="color:var(--text-muted)">
          <i class="fa-regular fa-folder-open"></i> Empty directory
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = items.map(item => {
    const icon = getFileIcon(item);
    const sizeStr = item.isDir ? '--' : formatBytes(item.size);
    const dateStr = item.modifyTime ? new Date(item.modifyTime).toLocaleString() : '--';
    const escapedPath = encodeURIComponent(item.path);

    return `
      <tr>
        <td style="text-align: center;">${icon}</td>
        <td>
          <div class="file-name-cell" onclick="handleItemClick('${escapedPath}', ${item.isDir})">
            <span>${item.name}</span>
          </div>
        </td>
        <td style="color: var(--text-dim); font-family: var(--font-mono);">${sizeStr}</td>
        <td style="color: var(--text-dim); font-family: var(--font-mono);">${item.permissions || '644'}</td>
        <td style="color: var(--text-dim);">${dateStr}</td>
        <td>
          <div class="cell-actions">
            ${!item.isDir ? `
              <button class="icon-btn-mini" onclick="downloadFile('${escapedPath}')" title="Download to laptop">
                <i class="fa-solid fa-download"></i>
              </button>
              <button class="icon-btn-mini" onclick="openFileEditor('${escapedPath}')" title="Edit File">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
            ` : ''}
            <button class="icon-btn-mini" onclick="renameItem('${escapedPath}', '${item.name}')" title="Rename">
              <i class="fa-solid fa-i-cursor"></i>
            </button>
            <button class="icon-btn-mini" onclick="deleteItem('${escapedPath}', ${item.isDir})" title="Delete" style="color: var(--danger)">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.handleItemClick = (encodedPath, isDir) => {
  const targetPath = decodeURIComponent(encodedPath);
  if (isDir) {
    loadDirectory(targetPath);
  } else {
    openFileEditor(encodedPath);
  }
};

// SFTP Navigation Toolbar
document.getElementById('btnSftpHome').addEventListener('click', () => {
  const def = currentConfig?.profiles[currentConfig.activeProfile]?.defaultPath || '/home/ubuntu';
  loadDirectory(def);
});

document.getElementById('btnSftpUp').addEventListener('click', () => {
  const parts = currentPath.split('/').filter(Boolean);
  parts.pop();
  const parent = '/' + parts.join('/');
  loadDirectory(parent || '/');
});

document.getElementById('btnSftpRefresh').addEventListener('click', () => {
  loadDirectory(currentPath);
});

document.getElementById('btnSftpGoPath').addEventListener('click', () => {
  const val = document.getElementById('sftpCurrentPath').value.trim();
  if (val) loadDirectory(val);
});

document.getElementById('sftpCurrentPath').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const val = e.target.value.trim();
    if (val) loadDirectory(val);
  }
});

// SFTP Actions (New Folder, New File, Delete, Rename)
document.getElementById('btnSftpNewFolder').addEventListener('click', async () => {
  const folderName = prompt('Enter new folder name:');
  if (!folderName) return;

  const targetPath = currentPath.endsWith('/') ? `${currentPath}${folderName}` : `${currentPath}/${folderName}`;
  try {
    const res = await fetch('/api/sftp/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mkdir', targetPath })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Folder created!', 'success');
      loadDirectory(currentPath);
    } else {
      showToast('Failed to create folder: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('Network error creating folder', 'error');
  }
});

document.getElementById('btnSftpNewFile').addEventListener('click', async () => {
  const fileName = prompt('Enter new file name:');
  if (!fileName) return;

  const targetPath = currentPath.endsWith('/') ? `${currentPath}${fileName}` : `${currentPath}/${fileName}`;
  try {
    const res = await fetch('/api/sftp/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath, content: '' })
    });
    const data = await res.json();
    if (data.success) {
      showToast('File created!', 'success');
      loadDirectory(currentPath);
      openFileEditor(encodeURIComponent(targetPath));
    } else {
      showToast('Failed to create file: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('Network error creating file', 'error');
  }
});

window.deleteItem = async (encodedPath, isDir) => {
  const targetPath = decodeURIComponent(encodedPath);
  const type = isDir ? 'directory' : 'file';
  if (!confirm(`Are you sure you want to permanently delete this ${type}?\n\n${targetPath}`)) {
    return;
  }

  try {
    const res = await fetch('/api/sftp/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', targetPath })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`${type} deleted!`, 'success');
      loadDirectory(currentPath);
    } else {
      showToast('Delete failed: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('Network error deleting item', 'error');
  }
};

window.renameItem = async (encodedPath, oldName) => {
  const targetPath = decodeURIComponent(encodedPath);
  const newName = prompt('Enter new name:', oldName);
  if (!newName || newName === oldName) return;

  const parent = targetPath.substring(0, targetPath.lastIndexOf('/'));
  const newPath = parent ? `${parent}/${newName}` : `/${newName}`;

  try {
    const res = await fetch('/api/sftp/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rename', targetPath, newPath })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Renamed successfully!', 'success');
      loadDirectory(currentPath);
    } else {
      showToast('Rename failed: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('Network error renaming item', 'error');
  }
};

window.downloadFile = (encodedPath) => {
  const targetPath = decodeURIComponent(encodedPath);
  window.open(`/api/sftp/download?path=${encodeURIComponent(targetPath)}`, '_blank');
  showToast('Starting file download...', 'info');
};

// File Editor Modal
window.openFileEditor = async (encodedPath) => {
  const targetPath = decodeURIComponent(encodedPath);
  const modal = document.getElementById('editorModal');
  const pathTitle = document.getElementById('editorFilePath');
  const textarea = document.getElementById('editorTextarea');
  const sizeInfo = document.getElementById('editorFileInfo');

  pathTitle.textContent = targetPath;
  textarea.value = 'Loading file content from VPS...';
  textarea.disabled = true;
  modal.classList.add('active');

  try {
    const res = await fetch(`/api/sftp/read?path=${encodeURIComponent(targetPath)}`);
    const data = await res.json();
    if (data.success) {
      currentEditingFile = targetPath;
      textarea.value = data.content;
      textarea.disabled = false;
      sizeInfo.textContent = `Size: ${formatBytes(data.size)}`;
    } else {
      textarea.value = `Error opening file: ${data.error}`;
      showToast(data.error, 'error');
    }
  } catch (err) {
    textarea.value = `Network error reading file: ${err.message}`;
  }
};

document.getElementById('btnCloseEditor').addEventListener('click', () => {
  document.getElementById('editorModal').classList.remove('active');
});

document.getElementById('btnCancelEditor').addEventListener('click', () => {
  document.getElementById('editorModal').classList.remove('active');
});

document.getElementById('btnSaveEditor').addEventListener('click', async () => {
  if (!currentEditingFile) return;
  const content = document.getElementById('editorTextarea').value;
  const btn = document.getElementById('btnSaveEditor');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

  try {
    const res = await fetch('/api/sftp/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentEditingFile, content })
    });
    const data = await res.json();
    if (data.success) {
      showToast('File saved to VPS!', 'success');
      document.getElementById('editorModal').classList.remove('active');
      loadDirectory(currentPath);
    } else {
      showToast('Save failed: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('Network error saving file: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Save to VPS';
  }
});

// Upload Handlers
async function uploadFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  const formData = new FormData();
  formData.append('destDir', currentPath);
  for (let i = 0; i < fileList.length; i++) {
    formData.append('files', fileList[i]);
  }

  showToast(`Uploading ${fileList.length} file(s) to VPS...`, 'info');

  try {
    const res = await fetch('/api/sftp/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadDirectory(currentPath);
    } else {
      showToast('Upload failed: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('Network error uploading file: ' + err.message, 'error');
  }
}

document.getElementById('fileUploadInput').addEventListener('change', (e) => {
  uploadFiles(e.target.files);
  e.target.value = '';
});

// Drag and Drop Upload
const dropZone = document.getElementById('sftpDropZone');
const sftpPanel = document.querySelector('.sftp-panel');

['dragenter', 'dragover'].forEach(eventName => {
  sftpPanel.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('active');
  });
});

['dragleave', 'drop'].forEach(eventName => {
  sftpPanel.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.target === dropZone || !sftpPanel.contains(e.relatedTarget)) {
      dropZone.classList.remove('active');
    }
  });
});

sftpPanel.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('active');
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    uploadFiles(e.dataTransfer.files);
  }
});

// === QUICK COMMANDS ===

function renderQuickCommands(commands) {
  const list = document.getElementById('quickCommandsList');
  list.innerHTML = commands.map(cmd => `
    <div class="cmd-preset-card" onclick="runPreset('${encodeURIComponent(cmd.cmd)}')">
      <span class="preset-title">${cmd.name}</span>
      <span class="preset-code">${cmd.cmd}</span>
    </div>
  `).join('');
}

window.runPreset = (encodedCmd) => {
  const cmd = decodeURIComponent(encodedCmd);
  document.getElementById('customCommandInput').value = cmd;
  executeCommand(cmd);
};

async function executeCommand(cmd) {
  if (!cmd) return;
  const consoleOutput = document.getElementById('cmdConsoleOutput');
  const statusBadge = document.getElementById('cmdExecStatus');
  const cwd = document.getElementById('cmdCwdInput').value.trim() || undefined;

  statusBadge.className = 'badge-status running';
  statusBadge.textContent = 'Running...';
  consoleOutput.textContent = `$ ${cmd}\n\n[Executing on VPS...]`;

  try {
    const res = await fetch('/api/ssh/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, cwd })
    });
    const data = await res.json();
    if (data.success) {
      statusBadge.className = 'badge-status success';
      statusBadge.textContent = `Exit Code 0`;
      consoleOutput.textContent = `$ ${cmd}\n\n${data.output || '(No output returned)'}`;
    } else {
      statusBadge.className = 'badge-status error';
      statusBadge.textContent = `Exit Code ${data.code ?? 'Error'}`;
      consoleOutput.textContent = `$ ${cmd}\n\n${data.output || data.error || 'Execution failed'}`;
    }
  } catch (err) {
    statusBadge.className = 'badge-status error';
    statusBadge.textContent = 'Network Error';
    consoleOutput.textContent = `$ ${cmd}\n\nNetwork error: ${err.message}`;
  }
}

document.getElementById('btnRunCustomCommand').addEventListener('click', () => {
  const cmd = document.getElementById('customCommandInput').value.trim();
  executeCommand(cmd);
});

document.getElementById('customCommandInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const cmd = e.target.value.trim();
    executeCommand(cmd);
  }
});

document.getElementById('btnClearConsole').addEventListener('click', () => {
  document.getElementById('cmdConsoleOutput').textContent = 'Console cleared.';
  document.getElementById('cmdExecStatus').className = 'badge-status ready';
  document.getElementById('cmdExecStatus').textContent = 'Ready';
});

document.getElementById('btnCopyConsole').addEventListener('click', () => {
  const text = document.getElementById('cmdConsoleOutput').textContent;
  navigator.clipboard.writeText(text);
  showToast('Console output copied to clipboard!', 'info');
});

// Add New Preset Modal
document.getElementById('btnAddNewCommand').addEventListener('click', () => {
  document.getElementById('commandModal').classList.add('active');
});
document.getElementById('btnCloseCmdModal').addEventListener('click', () => {
  document.getElementById('commandModal').classList.remove('active');
});
document.getElementById('btnCancelCmdModal').addEventListener('click', () => {
  document.getElementById('commandModal').classList.remove('active');
});

document.getElementById('btnSaveNewCmd').addEventListener('click', async () => {
  const name = document.getElementById('newCmdName').value.trim();
  const cmd = document.getElementById('newCmdBody').value.trim();
  if (!name || !cmd) {
    showToast('Please enter both name and command', 'error');
    return;
  }

  const cmds = currentConfig.quickCommands || [];
  cmds.push({ id: 'cmd_' + Date.now(), name, cmd });

  try {
    const res = await fetch('/api/config/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quickCommands: cmds })
    });
    const data = await res.json();
    if (data.success) {
      currentConfig.quickCommands = cmds;
      renderQuickCommands(cmds);
      document.getElementById('commandModal').classList.remove('active');
      document.getElementById('newCmdName').value = '';
      document.getElementById('newCmdBody').value = '';
      showToast('Quick command preset saved!', 'success');
    }
  } catch (err) {
    showToast('Failed to save preset', 'error');
  }
});

// === SYSTEM STATS ===
async function fetchServerStats() {
  document.getElementById('statHostname').textContent = 'Loading...';
  document.getElementById('statUptime').textContent = 'Loading...';
  document.getElementById('statCpu').textContent = 'Loading...';
  document.getElementById('statRam').textContent = 'Loading...';
  document.getElementById('statDisk').textContent = 'Loading...';

  try {
    const res = await fetch('/api/ssh/stats');
    const data = await res.json();
    if (data.success && data.stats) {
      document.getElementById('statHostname').textContent = data.stats.hostname;
      document.getElementById('statOs').textContent = data.stats.os;
      document.getElementById('statUptime').textContent = data.stats.uptime;
      document.getElementById('statUsers').textContent = `${data.stats.activeUsers} active user(s)`;
      document.getElementById('statCpu').textContent = data.stats.cpuUsage;
      document.getElementById('statLoad').textContent = `Load: ${data.stats.loadAvg}`;
      document.getElementById('statRam').textContent = data.stats.ramUsage;
      document.getElementById('statDisk').textContent = data.stats.diskUsage;
    } else {
      document.getElementById('statHostname').textContent = 'Error';
    }
  } catch (err) {
    document.getElementById('statHostname').textContent = 'Offline';
  }
}

document.getElementById('btnRefreshStats').addEventListener('click', fetchServerStats);

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  fetchConfig();
});
