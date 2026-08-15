#!/usr/bin/env node

const { Command } = require('commander');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const program = new Command();
const CONFIG_FILE = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG_FILE = path.join(__dirname, 'config.default.json');

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {}
  }
  if (fs.existsSync(DEFAULT_CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(DEFAULT_CONFIG_FILE, 'utf8'));
  }
  return { activeProfile: 'default', profiles: { default: { host: '', port: 22, username: 'ubuntu' } } };
}

function getCredentials(profileName) {
  const cfg = loadConfig();
  const target = profileName || cfg.activeProfile || 'default';
  const profile = cfg.profiles[target];
  if (!profile) {
    console.error(`❌ Profile "${target}" not found in config.json`);
    process.exit(1);
  }

  const connConfig = {
    host: profile.host || process.env.VPS_HOST,
    port: parseInt(profile.port || process.env.VPS_PORT || '22'),
    username: profile.username || process.env.VPS_USER || 'ubuntu',
    readyTimeout: 20000
  };

  if (profile.authType === 'key' && profile.privateKeyPath) {
    const keyPath = path.isAbsolute(profile.privateKeyPath)
      ? profile.privateKeyPath
      : path.resolve(__dirname, profile.privateKeyPath);
    connConfig.privateKey = fs.readFileSync(keyPath);
    if (profile.passphrase) connConfig.passphrase = profile.passphrase;
  } else {
    connConfig.password = profile.password || process.env.VPS_PASSWORD || '';
  }

  if (!connConfig.host) {
    console.error('❌ VPS Host is not configured. Run the web dashboard or edit config.json / .env');
    process.exit(1);
  }

  return connConfig;
}

function connect(creds) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => resolve(conn))
      .on('error', (err) => reject(err))
      .connect(creds);
  });
}

program
  .name('vps')
  .description('OVH Ubuntu VPS Remote Command & SFTP CLI Toolkit')
  .version('1.0.0');

// Test connection
program
  .command('test')
  .description('Test SSH connection to your VPS')
  .option('-p, --profile <profile>', 'Profile name')
  .action(async (options) => {
    const creds = getCredentials(options.profile);
    console.log(`Connecting to ${creds.username}@${creds.host}:${creds.port}...`);
    try {
      const conn = await connect(creds);
      console.log('✅ Connected successfully!');
      conn.end();
    } catch (err) {
      console.error('❌ Connection failed:', err.message);
      process.exit(1);
    }
  });

// Interactive Shell
program
  .command('shell')
  .alias('sh')
  .description('Launch interactive SSH shell in current terminal')
  .option('-p, --profile <profile>', 'Profile name')
  .action(async (options) => {
    const creds = getCredentials(options.profile);
    console.log(`Opening shell on ${creds.username}@${creds.host}...`);
    try {
      const conn = await connect(creds);
      conn.shell({
        term: process.env.TERM || 'xterm-256color',
        cols: process.stdout.columns || 80,
        rows: process.stdout.rows || 24
      }, (err, stream) => {
        if (err) throw err;

        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
        }
        process.stdin.pipe(stream);
        stream.pipe(process.stdout);
        stream.stderr.pipe(process.stderr);

        process.stdout.on('resize', () => {
          stream.setWindow(process.stdout.rows, process.stdout.columns, 0, 0);
        });

        stream.on('close', () => {
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          process.stdin.unpipe(stream);
          conn.end();
          process.exit(0);
        });
      });
    } catch (err) {
      console.error('❌ Shell error:', err.message);
      process.exit(1);
    }
  });

// Execute command
program
  .command('exec <command>')
  .description('Execute a single command on the VPS')
  .option('-p, --profile <profile>', 'Profile name')
  .action(async (command, options) => {
    const creds = getCredentials(options.profile);
    try {
      const conn = await connect(creds);
      conn.exec(command, (err, stream) => {
        if (err) throw err;
        stream.pipe(process.stdout);
        stream.stderr.pipe(process.stderr);
        stream.on('close', (code) => {
          conn.end();
          process.exit(code);
        });
      });
    } catch (err) {
      console.error('❌ Execution error:', err.message);
      process.exit(1);
    }
  });

// Server stats
program
  .command('stats')
  .description('Display system metrics (CPU, RAM, Disk, Uptime)')
  .option('-p, --profile <profile>', 'Profile name')
  .action(async (options) => {
    const creds = getCredentials(options.profile);
    try {
      const conn = await connect(creds);
      const cmd = `
        echo "=== System Overview ===";
        echo "Host:   $(hostname)";
        echo "Uptime: $(uptime -p 2>/dev/null || uptime)";
        echo "OS:     $(cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '"' 2>/dev/null || uname -srm)";
        echo "RAM:    $(free -h | awk 'NR==2{print $3 "/" $2}')";
        echo "Disk:   $(df -h / | awk 'NR==2{print $3 "/" $2 " (" $5 " used)"}')";
        echo "Load:   $(cat /proc/loadavg | awk '{print $1 ", " $2 ", " $3}')";
      `;
      conn.exec(cmd, (err, stream) => {
        if (err) throw err;
        stream.pipe(process.stdout);
        stream.on('close', () => {
          conn.end();
        });
      });
    } catch (err) {
      console.error('❌ Stats error:', err.message);
      process.exit(1);
    }
  });

// SFTP Commands
const sftpCmd = program.command('sftp').description('SFTP file operations');

sftpCmd
  .command('ls [remotePath]')
  .description('List files in a remote directory')
  .option('-p, --profile <profile>', 'Profile name')
  .action(async (remotePath = '/home/ubuntu', options) => {
    const creds = getCredentials(options?.profile);
    try {
      const conn = await connect(creds);
      conn.sftp((err, sftp) => {
        if (err) throw err;
        sftp.readdir(remotePath, (readErr, list) => {
          conn.end();
          if (readErr) {
            console.error('❌ Error reading directory:', readErr.message);
            return;
          }
          console.log(`\n📂 Directory listing for: ${remotePath}\n`);
          console.log(`${'Type'.padEnd(6)} ${'Size'.padStart(10)}  ${'Modified'.padEnd(25)}  Name`);
          console.log('-'.repeat(65));
          list.forEach(item => {
            const isDir = (item.attrs.mode & 0o40000) === 0o40000;
            const type = isDir ? 'DIR' : 'FILE';
            const size = isDir ? '-' : `${item.attrs.size} B`;
            const mtime = new Date(item.attrs.mtime * 1000).toLocaleString();
            console.log(`${type.padEnd(6)} ${size.padStart(10)}  ${mtime.padEnd(25)}  ${item.filename}`);
          });
          console.log('');
        });
      });
    } catch (err) {
      console.error('❌ SFTP error:', err.message);
    }
  });

sftpCmd
  .command('upload <localPath> <remotePath>')
  .description('Upload local file to VPS')
  .option('-p, --profile <profile>', 'Profile name')
  .action(async (localPath, remotePath, options) => {
    const creds = getCredentials(options?.profile);
    try {
      if (!fs.existsSync(localPath)) {
        console.error(`❌ Local file not found: ${localPath}`);
        return;
      }
      const conn = await connect(creds);
      conn.sftp((err, sftp) => {
        if (err) throw err;
        console.log(`Uploading ${localPath} -> ${remotePath}...`);
        sftp.fastPut(localPath, remotePath, (uploadErr) => {
          conn.end();
          if (uploadErr) {
            console.error('❌ Upload failed:', uploadErr.message);
            return;
          }
          console.log('✅ Upload completed successfully!');
        });
      });
    } catch (err) {
      console.error('❌ SFTP error:', err.message);
    }
  });

sftpCmd
  .command('download <remotePath> <localPath>')
  .description('Download remote file from VPS to laptop')
  .option('-p, --profile <profile>', 'Profile name')
  .action(async (remotePath, localPath, options) => {
    const creds = getCredentials(options?.profile);
    try {
      const conn = await connect(creds);
      conn.sftp((err, sftp) => {
        if (err) throw err;
        console.log(`Downloading ${remotePath} -> ${localPath}...`);
        sftp.fastGet(remotePath, localPath, (downloadErr) => {
          conn.end();
          if (downloadErr) {
            console.error('❌ Download failed:', downloadErr.message);
            return;
          }
          console.log('✅ Download completed successfully!');
        });
      });
    } catch (err) {
      console.error('❌ SFTP error:', err.message);
    }
  });

program.parse(process.argv);
