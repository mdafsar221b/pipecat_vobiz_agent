module.exports = {
  apps: [
    {
      name: "pipecat-vobiz-frontend",
      cwd: "/root/Aibot/outbound-ai/pipecat_vobiz_agent/frontend",
      script: "npm",
      args: "run dev -- --host 0.0.0.0 --port 3002 --strictPort",
      interpreter: "none",
      autorestart: true,
      watch: false,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        NODE_ENV: "production",
        BACKEND_PORT: "8010",
        PORT: "3002"
      }
    },
    {
      name: "pipecat-vobiz-backend",
      cwd: "/root/Aibot/outbound-ai/pipecat_vobiz_agent/backend",
      script: "/root/Aibot/outbound-ai/pipecat_vobiz_agent/.venv/bin/python",
      args: "-m uvicorn server:app --host 0.0.0.0 --port 8010",
      interpreter: "none",
      autorestart: true,
      watch: false,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        PORT: "8010",
        HTTP_PORT: "8010",
        PYTHONUNBUFFERED: "1"
      }
    }
  ]
};
