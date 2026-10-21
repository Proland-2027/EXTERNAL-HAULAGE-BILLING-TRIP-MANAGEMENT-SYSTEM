'use strict';
module.exports = function registerAll(router, ctx) {
  require('./masters.js')(router, ctx);
  require('./planning.js')(router, ctx);
  require('./production.js')(router, ctx);
  require('./reports.js')(router, ctx);
  require('./admin.js')(router, ctx);
};
