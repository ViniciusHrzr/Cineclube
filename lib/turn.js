const crypto = require('node:crypto');

const STUN_FALLBACK = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];

const TTL_SECONDS = 6 * 3600;

function list(name) {
  return (process.env[name] || '')
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function hasTurn() {
  return (
    list('TURN_URLS').length > 0 &&
    Boolean(process.env.TURN_SECRET || (process.env.TURN_USERNAME && process.env.TURN_PASSWORD))
  );
}

function iceServers(reviewerId, now = Date.now()) {
  const stun = list('STUN_URLS');
  const servers = [{ urls: stun.length ? stun : STUN_FALLBACK }];

  const turn = list('TURN_URLS');
  if (!turn.length) return servers;

  const secret = process.env.TURN_SECRET;
  if (secret) {
    const username = `${Math.floor(now / 1000) + TTL_SECONDS}:${reviewerId}`;
    const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
    servers.push({ urls: turn, username, credential });
    return servers;
  }

  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_PASSWORD;
  if (username && credential) servers.push({ urls: turn, username, credential });
  return servers;
}

module.exports = { iceServers, hasTurn, TTL_SECONDS, STUN_FALLBACK };
