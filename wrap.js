/* Express 4 does not look at what a handler returns. An async handler that
   rejects becomes an unhandledRejection and leaves the request hanging until
   it times out, instead of reaching the error handler. Wrapping one in this
   hands the rejection to next(), which is where the 500 in server.js waits. */
module.exports = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
