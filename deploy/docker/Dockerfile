# Layers OpenClaw OS on the upstream image without modifying upstream layers (plan §10.6).
ARG OPENCLAW_PIN=2026.9.2
FROM ghcr.io/openclaw/openclaw:${OPENCLAW_PIN}
ARG CLAWOS_VERSION=latest
USER root
RUN npm install -g "@clawkeepers/cli@${CLAWOS_VERSION}"
USER node
ENV OPENCLAW_NO_AUTO_UPDATE=1 CLAWOS_CELL=default
# `clawos install --in-container` runs at first start (see compose.yml); state persists in /home/node/.openclaw (includes os/).
