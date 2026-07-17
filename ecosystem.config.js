module.exports = {
  apps: [{
    name: 'falcon-ai-os',
    script: './server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    ignore_watch: [
      'logs',
      'node_modules',
      'cert.pem',
      'key.pem',
      '.env'
    ],
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
