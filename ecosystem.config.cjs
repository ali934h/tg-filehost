module.exports = {
  apps: [
    {
      name: "tg-filehost",
      script: "src/index.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env_file: ".env",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      merge_logs: true,
    },
  ],
};
