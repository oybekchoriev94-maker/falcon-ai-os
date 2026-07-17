module.exports = {
  apps: [{
    name: 'falcon-ai-os',
    script: './server.js',
    instances: process.env.NODE_ENV === 'production' ? -1 : 1,
    exec_mode: process.env.NODE_ENV === 'production' ? 'cluster' : 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    min_uptime: '10s',
    max_restarts: 10,
    listen_timeout: 8000,
    kill_timeout: 5000,
    ignore_watch: ['logs', 'node_modules', '*.pem', '.env', 'backup'],
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
