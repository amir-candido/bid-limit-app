module.exports = {
  apps: [
    {
      name: 'bid-limit-app',
      script: 'src/index.js',
      watch: ['src', 'config'],
      ignore_watch: ['node_modules', 'logs', '*.log',  '*.db', 'bidlimit.db-journal'],
      env_development: {
        NODE_ENV: 'development',
        watch: true // Enable watch only in development
      },
      env_production: {
        NODE_ENV: 'production',
        watch: false // Disable watch in production
      }
    }
  ]
};