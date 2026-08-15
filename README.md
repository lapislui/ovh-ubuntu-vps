# OVH Ubuntu VPS Remote Manager & SFTP Explorer 🚀

A full-featured Web GUI & CLI toolkit to connect to your OVH Ubuntu VPS directly from your laptop. Run commands in real-time, launch interactive terminals, and manage remote files visually with SFTP.

---

## 🌟 Key Features

### 🖥️ 1. Interactive Live Terminal (Web & CLI)
- Full interactive web SSH terminal with ANSI colors, window resizing, `xterm.js`, and WebSockets.
- Run interactive applications like `htop`, `nano`, `top`, `docker`, etc.
- Also supports native CLI shell: `npm run vps shell`.

### 📁 2. Visual SFTP File Explorer
- Browse remote files and folders in real time.
- **Drag-and-Drop Upload**: Simply drop files from Windows into the browser to upload.
- **Download**: 1-click download of remote files to your laptop.
- **In-Browser File Editor**: Open and edit configuration files (e.g. `nginx.conf`, `.env`, scripts) directly in the dashboard and save back to the VPS.
- Create new folders/files, delete, and rename.

### ⚡ 3. Quick Commands & Presets
- One-click diagnostic scripts (System Info, Memory `free -m`, Disk `df -h`, Docker containers, Listening ports `ss -tulpn`, Top CPU processes).
- Run arbitrary custom commands with working directory selection and output console logs.
- Add and save custom script presets.

### 📊 4. System Metrics & Stats
- Real-time CPU usage, RAM utilization, Disk space, Load average, Uptime, and Active Users.

### 🔒 5. Flexible Authentication
- Supports both **Password** and **SSH Private Key** (`.pem` / `id_rsa`) authentication.
- Stores credentials locally in `config.json` or `.env`.

---

## 🚀 Quick Start

### 1. Start the Web Dashboard
```bash
npm start
```
Then open your browser to **[http://localhost:3000](http://localhost:3000)**.

### 2. Enter VPS Connection Details
Go to the **Connection Settings** tab in the dashboard or configure `config.json` / `.env`:
- **Host**: Your OVH VPS IP (e.g. `51.75.xxx.xxx`)
- **Port**: `22` (default)
- **User**: `ubuntu` (or `root`)
- **Password** or **Private Key**: Enter your SSH password or path to your private key file.
- Click **Test Connection** & **Save & Connect**.

---

## 💻 CLI Commands (Command Prompt / PowerShell)

You can also run commands and transfer files straight from your terminal:

### Test Connection:
```bash
npm run vps test
```

### Launch Interactive Shell:
```bash
npm run vps shell
```

### Run a Single Remote Command:
```bash
npm run vps exec "uptime"
npm run vps exec "docker ps"
npm run vps exec "df -h"
```

### View Server Stats:
```bash
npm run vps stats
```

### SFTP Operations via CLI:
- **List files**:
  ```bash
  npm run vps sftp ls /home/ubuntu
  ```
- **Upload a local file to VPS**:
  ```bash
  npm run vps sftp upload ./my-script.sh /home/ubuntu/my-script.sh
  ```
- **Download a remote file to laptop**:
  ```bash
  npm run vps sftp download /home/ubuntu/app.log ./app.log
  ```

---

## 📁 Project Structure
```
ovh-ubuntu-vps/
├── cli.js               # CLI command-line companion tool
├── server.js            # Express, WebSocket, SSH2 & SFTP backend
├── package.json         # Project dependencies
├── config.default.json  # Default profile configuration & quick presets
├── config.json          # Your active settings (auto-generated)
├── .env.example         # Environment variable template
└── public/
    ├── index.html       # Web dashboard interface
    ├── style.css        # Cyber glassmorphism dark theme
    └── app.js           # Frontend logic & WebSocket xterm controller
```
