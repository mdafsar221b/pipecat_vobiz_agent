module.exports = {
  apps: [
    {
      name: "pipecat-vobiz-frontend",
      cwd: "/root/Aibot/outbound-ai/pipecat_vobiz_agent/frontend",
      script: "npm",
      args: "run dev -- --host 0.0.0.0 --port 3003 --strictPort",
      interpreter: "none",
      autorestart: true,
      watch: false,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        NODE_ENV: "production",
        BACKEND_PORT: "8011",
        PORT: "3003",
        VITE_PORT: "3003"
      }
    },
    {
      name: "pipecat-vobiz-backend",
      cwd: "/root/Aibot/outbound-ai/pipecat_vobiz_agent/backend",
      script: "/root/Aibot/outbound-ai/pipecat_vobiz_agent/.venv/bin/python",
      args: "-m uvicorn server:app --host 0.0.0.0 --port 8011",
      interpreter: "none",
      autorestart: true,
      watch: false,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        PORT: "8011",
        HTTP_PORT: "8011",
        PYTHONUNBUFFERED: "1"
      }
    }
  ]
};
