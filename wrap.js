/* Express 4 não olha o que um handler devolve: um handler async que rejeita
   vira unhandledRejection e deixa o pedido pendurado até o timeout, em vez de
   chegar no tratador de erro. Isto entrega a rejeição ao next(). */
module.exports = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
