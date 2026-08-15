const express = require('express');
const http = require('http');
const net = require('net');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');
const multer = require('multer');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/terminal' });

const upload = multer({ dest: path.join(__dirname, 'temp_uploads') });

const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG_FILE = path.join(__dirname, 'config.default.json');

// Ensure temp_uploads folder exists
if (!fs.existsSync(path.join(__dirname, 'temp_uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'temp_uploads'), { recursive: true });
}

// IN-MEMORY SESSION (Pure form login, no credentials saved to disk)
let activeSession = null;

// Load quick commands & configuration
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {}
  }
  if (fs.existsSync(DEFAULT_CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DEFAULT_CONFIG_FILE, 'utf8'));
    } catch (e) {}
  }
  return { quickCommands: [] };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

function buildSSHConfig(profile) {
  if (!profile || !profile.host) {
    throw new Error('Please enter VPS Host IP in the login form.');
  }

  const connConfig = {
    host: profile.host,
    port: parseInt(profile.port) || 22,
    username: profile.username || 'ubuntu',
    readyTimeout: 20000,
    keepaliveInterval: 10000
  };

  if (profile.authType === 'key' && profile.privateKeyPath) {
    try {
      const keyPath = path.isAbsolute(profile.privateKeyPath) 
        ? profile.privateKeyPath 
        : path.resolve(__dirname, profile.privateKeyPath);
      connConfig.privateKey = fs.readFileSync(keyPath);
      if (profile.passphrase) connConfig.passphrase = profile.passphrase;
    } catch (err) {
      throw new Error(`Failed to read SSH private key: ${err.message}`);
    }
  } else {
    connConfig.password = profile.password || '';
  }

  return { connConfig, profile };
}

function getActiveCredentials() {
  if (!activeSession) {
    throw new Error('No active session. Please log in using the login form.');
  }
  return buildSSHConfig(activeSession);
}

// Connect SSH helper
function createSSHClient(credentials) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => resolve(conn))
      .on('error', (err) => reject(err))
      .connect(credentials);
  });
}

// Connect SFTP helper
function getSFTP(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      resolve(sftp);
    });
  });
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// === AUTH & SESSION API ===

// Form Login endpoint
app.post('/api/auth/login', async (req, res) => {
  let conn;
  try {
    const profile = req.body;
    if (!profile || !profile.host) {
      return res.status(400).json({ success: false, error: 'Server IP / Host is required' });
    }

    const { connConfig } = buildSSHConfig(profile);

    // Verify connection directly with VPS
    conn = await createSSHClient(connConfig);
    conn.end();

    // Store in active in-memory session
    activeSession = {
      host: profile.host,
      port: parseInt(profile.port) || 22,
      username: profile.username || 'ubuntu',
      authType: profile.authType || 'password',
      password: profile.password || '',
      privateKeyPath: profile.privateKeyPath || '',
      passphrase: profile.passphrase || '',
      defaultPath: profile.defaultPath || ('/home/' + (profile.username || 'ubuntu'))
    };

    res.json({
      success: true,
      message: `Successfully connected to ${activeSession.username}@${activeSession.host}`,
      user: activeSession.username,
      host: activeSession.host,
      defaultPath: activeSession.defaultPath
    });
  } catch (err) {
    if (conn) conn.end();
    res.status(400).json({ success: false, error: err.message });
  }
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
  activeSession = null;
  res.json({ success: true, message: 'Logged out successfully' });
});

// Session Status endpoint
app.get('/api/auth/status', (req, res) => {
  if (activeSession) {
    res.json({
      isLoggedIn: true,
      user: activeSession.username,
      host: activeSession.host,
      port: activeSession.port,
      defaultPath: activeSession.defaultPath
    });
  } else {
    res.json({ isLoggedIn: false });
  }
});

// Test Connection endpoint
app.post('/api/config/test', async (req, res) => {
  let conn;
  try {
    const profile = req.body.profile || activeSession;
    if (!profile) {
      return res.status(400).json({ success: false, error: 'No connection details provided' });
    }

    const { connConfig } = buildSSHConfig(profile);
    conn = await createSSHClient(connConfig);
    conn.end();
    res.json({ success: true, message: `Connected to ${connConfig.username}@${connConfig.host}:${connConfig.port}!` });
  } catch (err) {
    if (conn) conn.end();
    res.status(400).json({ success: false, error: err.message });
  }
});

// Quick Commands config
app.get('/api/config', (req, res) => {
  try {
    const cfg = loadConfig();
    res.json({ success: true, quickCommands: cfg.quickCommands || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/config/commands', (req, res) => {
  try {
    const { quickCommands } = req.body;
    const cfg = loadConfig();
    cfg.quickCommands = quickCommands;
    saveConfig(cfg);
    res.json({ success: true, message: 'Quick commands updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === SSH COMMAND EXECUTION API ===

app.post('/api/ssh/exec', async (req, res) => {
  let conn;
  try {
    const { command, cwd } = req.body;
    if (!command) {
      return res.status(400).json({ success: false, error: 'Command is required' });
    }

    const { connConfig } = getActiveCredentials();
    conn = await createSSHClient(connConfig);

    const fullCmd = cwd ? `cd ${JSON.stringify(cwd)} && ${command}` : command;

    conn.exec(fullCmd, (err, stream) => {
      if (err) {
        conn.end();
        return res.status(500).json({ success: false, error: err.message });
      }

      let stdout = '';
      let stderr = '';

      stream.on('close', (code, signal) => {
        conn.end();
        res.json({
          success: code === 0,
          code,
          signal,
          stdout,
          stderr,
          output: stdout + (stderr ? '\n' + stderr : '')
        });
      });

      stream.on('data', (data) => {
        stdout += data.toString('utf8');
      });

      stream.stderr.on('data', (data) => {
        stderr += data.toString('utf8');
      });
    });
  } catch (err) {
    if (conn) conn.end();
    res.status(500).json({ success: false, error: err.message });
  }
});

// === SERVER STATS API ===

app.get('/api/ssh/stats', async (req, res) => {
  let conn;
  try {
    const { connConfig } = getActiveCredentials();
    conn = await createSSHClient(connConfig);

    const statScript = `
      echo "===HOSTNAME===" && hostname;
      echo "===UPTIME===" && uptime -p 2>/dev/null || uptime;
      echo "===OS===" && (cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '"') || uname -srm;
      echo "===CPU===" && top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk '{print 100 - $1}';
      echo "===RAM===" && free -m | awk 'NR==2{printf "%s/%s MB (%.2f%%)", $3,$2,$3*100/$2 }';
      echo "===DISK===" && df -h / | awk 'NR==2{print $3 "/" $2 " (" $5 ")"}';
      echo "===LOAD===" && cat /proc/loadavg | awk '{print $1 ", " $2 ", " $3}';
      echo "===USERS===" && who | wc -l;
    `;

    conn.exec(statScript, (err, stream) => {
      if (err) {
        conn.end();
        return res.status(500).json({ success: false, error: err.message });
      }

      let output = '';
      stream.on('data', (d) => { output += d.toString('utf8'); });
      stream.on('close', () => {
        conn.end();

        const parseSection = (tag) => {
          const match = output.match(new RegExp(`===${tag}===\\s*\\n([^=]+)`));
          return match ? match[1].trim() : 'N/A';
        };

        res.json({
          success: true,
          stats: {
            hostname: parseSection('HOSTNAME'),
            uptime: parseSection('UPTIME'),
            os: parseSection('OS'),
            cpuUsage: parseSection('CPU') + '%',
            ramUsage: parseSection('RAM'),
            diskUsage: parseSection('DISK'),
            loadAvg: parseSection('LOAD'),
            activeUsers: parseSection('USERS')
          }
        });
      });
    });
  } catch (err) {
    if (conn) conn.end();
    res.status(500).json({ success: false, error: err.message });
  }
});

// === SFTP FILE OPERATIONS API ===

// List directory
app.get('/api/sftp/list', async (req, res) => {
  let conn;
  try {
    const { connConfig, profile } = getActiveCredentials();
    let targetPath = req.query.path || profile.defaultPath || '/home/ubuntu';

    conn = await createSSHClient(connConfig);
    const sftp = await getSFTP(conn);

    sftp.realpath(targetPath, (err, resolvedPath) => {
      const currentPath = (!err && resolvedPath) ? resolvedPath : targetPath;

      sftp.readdir(currentPath, (err, list) => {
        conn.end();
        if (err) {
          return res.status(500).json({ success: false, error: err.message, path: currentPath });
        }

        const items = list.map(item => {
          const isDir = (item.attrs.mode & 0o40000) === 0o40000;
          const isSymlink = (item.attrs.mode & 0o120000) === 0o120000;
          return {
            name: item.filename,
            path: currentPath === '/' ? `/${item.filename}` : `${currentPath}/${item.filename}`,
            isDir,
            isSymlink,
            size: item.attrs.size,
            modifyTime: item.attrs.mtime * 1000,
            permissions: (item.attrs.mode & 0o777).toString(8)
          };
        });

        items.sort((a, b) => {
          if (a.isDir && !b.isDir) return -1;
          if (!a.isDir && b.isDir) return 1;
          return a.name.localeCompare(b.name);
        });

        res.json({
          success: true,
          path: currentPath,
          items
        });
      });
    });
  } catch (err) {
    if (conn) conn.end();
    res.status(500).json({ success: false, error: err.message });
  }
});

// Read file content
app.get('/api/sftp/read', async (req, res) => {
  let conn;
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ success: false, error: 'Path is required' });

    const { connConfig } = getActiveCredentials();
    conn = await createSSHClient(connConfig);
    const sftp = await getSFTP(conn);

    sftp.stat(filePath, (err, stats) => {
      if (err) {
        conn.end();
        return res.status(404).json({ success: false, error: err.message });
      }

      if (stats.size > 5 * 1024 * 1024) {
        conn.end();
        return res.status(400).json({ success: false, error: 'File is larger than 5MB. Please download it instead.' });
      }

      const stream = sftp.createReadStream(filePath);
      let content = '';

      stream.on('data', chunk => { content += chunk.toString('utf8'); });
      stream.on('end', () => {
        conn.end();
        res.json({ success: true, path: filePath, size: stats.size, content });
      });
      stream.on('error', (readErr) => {
        conn.end();
        res.status(500).json({ success: false, error: readErr.message });
      });
    });
  } catch (err) {
    if (conn) conn.end();
    res.status(500).json({ success: false, error: err.message });
  }
});

// Write / Save file content
app.post('/api/sftp/write', async (req, res) => {
  let conn;
  try {
    const { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ success: false, error: 'Path is required' });

    const { connConfig } = getActiveCredentials();
    conn = await createSSHClient(connConfig);
    const sftp = await getSFTP(conn);

    const writeStream = sftp.createWriteStream(filePath, { flags: 'w', mode: 0o644 });
    writeStream.on('close', () => {
      conn.end();
      res.json({ success: true, message: `File saved successfully: ${filePath}` });
    });
    writeStream.on('error', (err) => {
      conn.end();
      res.status(500).json({ success: false, error: err.message });
    });

    writeStream.write(content, 'utf8');
    writeStream.end();
  } catch (err) {
    if (conn) conn.end();
    res.status(500).json({ success: false, error: err.message });
  }
});

// Download file stream
app.get('/api/sftp/download', async (req, res) => {
  let conn;
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send('Path is required');

    const { connConfig } = getActiveCredentials();
    conn = await createSSHClient(connConfig);
    const sftp = await getSFTP(conn);

    sftp.stat(filePath, (err, stats) => {
      if (err) {
        conn.end();
        return res.status(404).send('File not found: ' + err.message);
      }

      const filename = path.basename(filePath);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Content-Type', 'application/octet-stream');

      const stream = sftp.createReadStream(filePath);
      stream.pipe(res);

      stream.on('close', () => {
        conn.end();
      });
      stream.on('error', () => {
        conn.end();
      });
    });
  } catch (err) {
    if (conn) conn.end();
    res.status(500).send('Download error: ' + err.message);
  }
});

// Upload file to SFTP
app.post('/api/sftp/upload', upload.array('files'), async (req, res) => {
  let conn;
  try {
    const destDir = req.body.destDir;
    if (!destDir) return res.status(400).json({ success: false, error: 'Destination directory is required' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, error: 'No files uploaded' });

    const { connConfig } = getActiveCredentials();
    conn = await createSSHClient(connConfig);
    const sftp = await getSFTP(conn);

    const uploadedResults = [];

    for (const file of req.files) {
      const remoteFilePath = destDir.endsWith('/') ? `${destDir}${file.originalname}` : `${destDir}/${file.originalname}`;
      await new Promise((resolve, reject) => {
        sftp.fastPut(file.path, remoteFilePath, (err) => {
          try { fs.unlinkSync(file.path); } catch (e) {}
          if (err) return reject(err);
          uploadedResults.push({ name: file.originalname, remotePath: remoteFilePath });
          resolve();
        });
      });
    }

    conn.end();
    res.json({ success: true, message: `Successfully uploaded ${uploadedResults.length} file(s)`, files: uploadedResults });
  } catch (err) {
    if (conn) conn.end();
    if (req.files) {
      req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(e) {} });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// File/Folder actions (mkdir, delete, rename, chmod)
app.post('/api/sftp/action', async (req, res) => {
  let conn;
  try {
    const { action, targetPath, newPath, mode } = req.body;
    if (!action || !targetPath) {
      return res.status(400).json({ success: false, error: 'Action and targetPath are required' });
    }

    const { connConfig } = getActiveCredentials();
    conn = await createSSHClient(connConfig);
    const sftp = await getSFTP(conn);

    if (action === 'mkdir') {
      sftp.mkdir(targetPath, (err) => {
        conn.end();
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, message: 'Folder created successfully' });
      });
    } else if (action === 'delete') {
      sftp.stat(targetPath, (statErr, stats) => {
        if (statErr) {
          conn.end();
          return res.status(404).json({ success: false, error: statErr.message });
        }
        const isDir = (stats.mode & 0o40000) === 0o40000;
        if (isDir) {
          conn.exec(`rm -rf ${JSON.stringify(targetPath)}`, (execErr, stream) => {
            if (execErr) {
              conn.end();
              return res.status(500).json({ success: false, error: execErr.message });
            }
            stream.on('close', (code) => {
              conn.end();
              if (code === 0) res.json({ success: true, message: 'Directory deleted successfully' });
              else res.status(500).json({ success: false, error: `rm exited with code ${code}` });
            });
          });
        } else {
          sftp.unlink(targetPath, (unlinkErr) => {
            conn.end();
            if (unlinkErr) return res.status(500).json({ success: false, error: unlinkErr.message });
            res.json({ success: true, message: 'File deleted successfully' });
          });
        }
      });
    } else if (action === 'rename') {
      if (!newPath) {
        conn.end();
        return res.status(400).json({ success: false, error: 'newPath is required for rename' });
      }
      sftp.rename(targetPath, newPath, (renameErr) => {
        conn.end();
        if (renameErr) return res.status(500).json({ success: false, error: renameErr.message });
        res.json({ success: true, message: 'Renamed successfully' });
      });
    } else if (action === 'chmod') {
      const octalMode = parseInt(mode, 8);
      sftp.chmod(targetPath, octalMode, (chmodErr) => {
        conn.end();
        if (chmodErr) return res.status(500).json({ success: false, error: chmodErr.message });
        res.json({ success: true, message: 'Permissions updated successfully' });
      });
    } else {
      conn.end();
      res.status(400).json({ success: false, error: `Unknown action: ${action}` });
    }
  } catch (err) {
    if (conn) conn.end();
    res.status(500).json({ success: false, error: err.message });
  }
});

// === WEBSOCKET INTERACTIVE TERMINAL ===

wss.on('connection', async (ws) => {
  let conn = null;
  let stream = null;

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg.toString('utf8'));

      if (data.type === 'init') {
        const { cols = 80, rows = 24 } = data;
        let creds;
        try {
          creds = getActiveCredentials().connConfig;
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: e.message }));
          return;
        }

        conn = new Client();
        conn.on('ready', () => {
          conn.shell({ term: 'xterm-256color', cols, rows }, (err, s) => {
            if (err) {
              ws.send(JSON.stringify({ type: 'error', message: 'Failed to start shell: ' + err.message }));
              conn.end();
              return;
            }
            stream = s;

            stream.on('data', (d) => {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'data', data: d.toString('utf8') }));
              }
            });

            stream.on('close', () => {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'close', message: 'SSH session closed' }));
              }
              if (conn) conn.end();
            });

            ws.send(JSON.stringify({ type: 'connected', message: `Connected to ${creds.username}@${creds.host}` }));
          });
        });

        conn.on('error', (err) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'error', message: 'SSH Connection Error: ' + err.message }));
          }
        });

        conn.on('end', () => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'close', message: 'Disconnected from host' }));
          }
        });

        conn.connect(creds);
      } else if (data.type === 'input' && stream) {
        stream.write(data.data);
      } else if (data.type === 'resize' && stream) {
        stream.setWindow(data.rows, data.cols, 0, 0);
      }
    } catch (parseErr) {
      console.error('WS message error:', parseErr.message);
    }
  });

  ws.on('close', () => {
    if (stream) stream.end();
    if (conn) conn.end();
  });
});

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.once('close', () => resolve(true)).close();
      })
      .listen(port);
  });
}

async function startServer(preferredPort) {
  let port = preferredPort;
  while (!(await isPortAvailable(port))) {
    console.log(`⚠️  Port ${port} is currently in use, trying port ${port + 1}...`);
    port++;
  }

  server.listen(port, () => {
    console.log(`\n====================================================`);
    console.log(`🚀 OVH Ubuntu VPS Remote Manager & SFTP Explorer`);
    console.log(`🌐 Dashboard running at: http://localhost:${port}`);
    console.log(`====================================================\n`);
  });
}

startServer(Number(PORT));
