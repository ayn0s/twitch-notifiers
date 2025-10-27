# Twitch → Discord Webhook Notifier

A minimal, containerized service that monitors one or more Twitch streamers and sends a Discord webhook message when a stream goes live.

This project is built with Node.js, uses the official Twitch Helix API, and is distributed as a Docker container.  
It is designed to be simple to deploy, reliable in production, and easy to customize through a JSON message template.

---

## Overview

The notifier periodically queries the Twitch API to check if any of the configured streamers are live.  
When a streamer transitions from **offline** to **live**, the application sends a Discord webhook message using a user-defined template.  
Stream state is persisted locally to prevent duplicate notifications after restarts.

---

## Features

- Supports multiple Twitch streamers  
- Uses the official Twitch API (no HTML scraping)  
- Discord webhook integration (no Discord bot required)  
- Customizable message and embed via JSON template  
- State persistence between runs  
- Lightweight and self-contained Docker image  
- Simple configuration through environment variables  

---

## Requirements

- Docker or Docker Compose  
- A Discord webhook URL  
- A Twitch Developer application (Client ID and Client Secret)

---

## Getting Twitch API Credentials

1. Go to [Twitch Developer Console](https://dev.twitch.tv/console/apps)
2. Log in with your Twitch account
3. Click **“+ Register Your Application”**
4. Fill in the following fields:
   - **Name:** any name (e.g. `discord-live-notifier`)
   - **OAuth Redirect URLs:** `https://localhost`
   - **Category:** Application Integration
5. Click **Create**
6. Copy the **Client ID**
7. Click **“New Secret”** to generate and copy your **Client Secret**

These values are used in your `.env` configuration file.

---

## Configuration

Copy `.env.example` to `.env` and update it with your values:

```bash
cp .env.example .env
```

Example:

```env
# Discord webhook
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/XXXXXXXX/XXXXXXXX
MENTION_EVERYONE=false
MENTION_ROLE_ID=

# Twitch credentials
TWITCH_CLIENT_ID=your-client-id
TWITCH_CLIENT_SECRET=your-client-secret

# Comma-separated list of Twitch usernames to monitor
STREAMERS=tenz,soon

# Poll interval in milliseconds
CHECK_INTERVAL_MS=90000

# Paths and logging
DATA_DIR=/app/data
TEMPLATE_PATH=/app/templates/message_template.json
LOG_LEVEL=info
```

---

## Template Customization

The message template defines the structure and content of the Discord webhook payload.  
Edit the file `templates/message_template.json` to modify the message or embed.

Example template:

```json
{
  "content": "{{mention_prefix}} {{display_name}} just went live: {{url}}",
  "embeds": [
    {
      "title": "{{title}}",
      "url": "{{url}}",
      "description": "{{#if game_name}}Game: {{game_name}}{{/if}}",
      "timestamp": "{{now_iso}}",
      "author": {
        "name": "{{display_name}}",
        "url": "{{url}}",
        "icon_url": "{{profile_image_url}}"
      },
      "image": {
        "url": "{{thumbnail_url}}"
      },
      "footer": {
        "text": "Twitch"
      }
    }
  ],
  "username": "My Bot Name",
  "avatar_url": "https://img.freepik.com/vecteurs-libre/robot-vectoriel-graident-ai_78370-4114.jpg?semt=ais_hybrid&w=740&q=80"

}
```

### Supported placeholders
| Placeholder | Description |
|--------------|--------------|
| `{{login}}` | Twitch username |
| `{{display_name}}` | Twitch display name |
| `{{url}}` | Twitch channel URL |
| `{{title}}` | Stream title |
| `{{game_name}}` | Current game name |
| `{{thumbnail_url}}` | Stream thumbnail URL (1280×720) |
| `{{profile_image_url}}` | Streamer avatar URL |
| `{{started_at}}` | Stream start time (ISO) |
| `{{now_iso}}` | Current time in ISO format |
| `{{mention_prefix}}` | Mention string (`@everyone`, `<@&ROLE_ID>`, or empty) |

Conditionals are supported:
```
{{#if field}}text to include if field is set{{/if}}
```

The template is reloaded automatically on every notification, allowing you to edit it without restarting the container.

---

## Running with Docker Compose

```bash
docker compose up -d --build
```

Check logs:

```bash
docker compose logs -f
```

The container:
- Fetches and refreshes its Twitch OAuth token automatically
- Persists state in `./data`
- Reads configuration from `.env`
- Sends webhook notifications when streams start

---

## Running with Docker CLI

```bash
docker build -t twitch-discord-notifier .
docker run -d   --name twitch-notifier   --env-file .env   -v $(pwd)/data:/app/data   -v $(pwd)/templates:/app/templates:ro   --restart unless-stopped   twitch-discord-notifier
```

---


## Project Structure

```
twitch-discord-notifier/
├─ Dockerfile
├─ docker-compose.yml
├─ package.json
├─ index.js
├─ .env.example
├─ templates/
│  └─ message_template.json
└─ data/
```

---


## Environment Variables Summary

| Variable | Description | Required | Default |
|-----------|--------------|-----------|----------|
| `DISCORD_WEBHOOK_URL` | Discord webhook URL | Yes | - |
| `MENTION_EVERYONE` | Whether to ping everyone (`true` / `false`) | No | `false` |
| `MENTION_ROLE_ID` | Role ID to mention | No | empty |
| `TWITCH_CLIENT_ID` | Twitch API client ID | Yes | - |
| `TWITCH_CLIENT_SECRET` | Twitch API client secret | Yes | - |
| `STREAMERS` | Comma-separated Twitch usernames | Yes | - |
| `CHECK_INTERVAL_MS` | Polling interval in ms | No | `90000` |
| `DATA_DIR` | Path for persistent state | No | `/app/data` |
| `TEMPLATE_PATH` | Path to JSON message template | No | `/app/templates/message_template.json` |
| `LOG_LEVEL` | `info` or `debug` | No | `info` |

---

