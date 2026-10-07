const VERSION = 1;

const MIN_CLIENT = 1;

function middleware() {
  return function contract(req, res, next) {
    res.setHeader('X-API-Version', String(VERSION));
    next();
  };
}

function meta(_req, res) {
  res.json({ api: VERSION, minClient: MIN_CLIENT });
}

module.exports = { VERSION, MIN_CLIENT, middleware, meta };
