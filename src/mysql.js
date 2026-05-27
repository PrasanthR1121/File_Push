const mysql = require("mysql2/promise");

function createPool(config) {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: config.waitForConnections ?? true,
    multipleStatements: config.multipleStatements ?? false,
    connectionLimit: 5,
    namedPlaceholders: config.namedPlaceholders ?? true,
    queueLimit: config.queueLimit ?? 0,
    dateStrings: true,
    ...poolOverrides(config)
  });
}

function poolOverrides(config) {
  const overrides = {};

  if (config.connectionLimit !== undefined) {
    overrides.connectionLimit = Number(config.connectionLimit);
  }

  if (config.port !== undefined) {
    overrides.port = Number(config.port);
  }

  return overrides;
}

module.exports = {
  createPool
};
