let oracleInitialized = false;

function initializeOracleClient(oracleClient) {
  if (oracleInitialized) {
    return;
  }

  if (oracleClient && (oracleClient.libDir || oracleClient.tnsAdmin)) {
    const oracledb = require("oracledb");
    oracledb.initOracleClient({
      libDir: oracleClient.libDir,
      configDir: oracleClient.tnsAdmin
    });
  }

  oracleInitialized = true;
}

async function getOracleConnection(oracleDb, oracleClient) {
  initializeOracleClient(oracleClient);
  const oracledb = require("oracledb");

  return oracledb.getConnection({
    user: oracleDb.user,
    password: oracleDb.password,
    connectString: oracleDb.connectString
  });
}

module.exports = {
  getOracleConnection
};
