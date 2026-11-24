#!/bin/bash
set -e

# Setup script for Hostinger VPS Docker deployment
echo "Updating packages..."
sudo apt-get update -y
sudo apt-get install -y docker.io docker-compose-v2 git curl ufw

echo "Enabling Docker service..."
sudo systemctl enable --now docker

echo "Setting up application directory..."
sudo mkdir -p /var/www/pipecat_vobiz_agent
sudo chown -R $USER:$USER /var/www/pipecat_vobiz_agent

echo "VPS environment prepared."
echo "Next steps:"
echo "1. Clone repository to /var/www/pipecat_vobiz_agent"
echo "2. Copy .env.example to .env and configure secrets"
echo "3. Run 'docker compose up -d' for initial run"
