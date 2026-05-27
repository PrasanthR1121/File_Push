const { createPool } = require("./mysql");
const { getOracleConnection } = require("./oracle");

async function testConnections(runtimeConfig) {
  const results = [];

  for (const databaseConfig of runtimeConfig.databases) {
    const mysqlPool = createPool(databaseConfig.mysqlDb);
    const oracleConnection = await getOracleConnection(
      databaseConfig.oracleDb,
      databaseConfig.oracleClient
    );

    try {
      await mysqlPool.query("SELECT 1 AS OK");
      await oracleConnection.execute("SELECT 1 FROM DUAL");
      results.push({
        mysqlDatabase: databaseConfig.mysqlDb.database,
        oracleConnectString: databaseConfig.oracleDb.connectString,
        oracleUser: databaseConfig.oracleDb.user,
        ok: true
      });
    } finally {
      await oracleConnection.close();
      await mysqlPool.end();
    }
  }

  return results;
}

module.exports = {
  testConnections
};
