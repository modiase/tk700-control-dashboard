# TK700 Controller Dashboard

Web control interface for BenQ TK700 projector via RS232-over-TCP.

![Dashboard](/src/assets/image.png)

## Quick Start

```bash
nix run
```

Access at `http://localhost:3000`

## Environment Variables

| Variable                   | Default | Description                              |
| -------------------------- | ------- | ---------------------------------------- |
| `TK700_CONTROLLER_HOST`    | -       | Projector IP address (required)          |
| `TK700_CONTROLLER_PORT`    | -       | Projector RS232-over-TCP port (required) |
| `TK700_CONTROLLER_TIMEOUT` | 5000    | Connection timeout in milliseconds       |
| `PORT`                     | -       | Web server port (required)               |

## Systemd Deployment

Example service at `/etc/systemd/system/benq-control.service`:

```ini
[Unit]
Description=BenQ TK700 Controller Dashboard
After=network-online.target

[Service]
ExecStart=/run/current-system/sw/bin/tk700-controller-dashboard-server
Environment="TK700_CONTROLLER_HOST=192.168.1.80"
Environment="TK700_CONTROLLER_PORT=8234"
Environment="PORT=3000"
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Note: Server expects to run from its installation directory to serve static assets. The Nix package handles this via wrapper script.

## Development

```bash
pnpm install && pnpm start
```

Runs vite dev server (frontend with hot reload) + bun backend server separately.

## Features

- On/Off control
- Temperature and fan monitoring
- Volume and picture settings (brightness, contrast, sharpness)
- Source selection
- Keystone control
- Menu control

## Requirements

- BenQ TK700
- RS232-Ethernet adapter
