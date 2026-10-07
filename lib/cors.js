const SHELLS = [
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
];

const extras = (process.env.CINECLUBE_ORIGINS || '')
  .split(',')
  .map(o => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

const allowed = new Set([...SHELLS, ...extras]);

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const dev = () => process.env.NODE_ENV !== 'production' && process.env.CINECLUBE_HTTPS !== '1';

function permitted(origin) {
  if (!origin) return false;
  if (allowed.has(origin)) return true;
  return dev() && LOCAL.test(origin);
}

const HEADERS = 'Content-Type, Authorization';
const METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const MAX_AGE = 86400;

function middleware() {
  return function cors(req, res, next) {
    const origin = req.headers.origin;

    res.setHeader('Vary', 'Origin');

    if (!permitted(origin)) {
      if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
        return res.status(204).end();
      }
      return next();
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
      res.setHeader('Access-Control-Allow-Methods', METHODS);
      res.setHeader('Access-Control-Allow-Headers', HEADERS);
      res.setHeader('Access-Control-Max-Age', String(MAX_AGE));
      return res.status(204).end();
    }

    next();
  };
}

module.exports = { middleware, permitted, SHELLS };
