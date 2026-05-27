const path = require("path");
const fs = require("fs");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
  quiet: true
});

function readRuntimeConfig() {
  const envName = process.env.APP_ENV || process.env.NODE_ENV || "dev";
  const configFileName = envName === "dev" ? "config.dev.json" : "config.prod.json";
  const configPath = path.resolve(__dirname, "..", "config", configFileName);

  if (!fs.existsSync(configPath)) {
    throw new Error(`Runtime config not found: ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  resolveEnvValues(config);
  const databases = config.database || [];

  if (databases.length === 0 || databases.length > 2) {
    throw new Error("Config must contain one or two database entries");
  }

  for (const database of databases) {
    if (!database.mysqlDb || !database.oracleDb) {
      throw new Error("Each database entry must contain mysqlDb and oracleDb");
    }
  }

  if (!config.cdrSync || !config.cdrSync.sourceTable || !config.cdrSync.targetTable) {
    throw new Error("Config must contain cdrSync.sourceTable and cdrSync.targetTable");
  }

  return {
    envName,
    configPath,
    log: config.log || {},
    remoteProtocol: config.remoteProtocol || "FTP",
    cdrSync: {
      batchSize: Number(config.cdrSync.batchSize || 1000),
      sourceTable: config.cdrSync.sourceTable,
      targetTable: config.cdrSync.targetTable,
      controlTable: config.cdrSync.controlTable || "bsp_control_table",
      controlDescription: config.cdrSync.controlDescription || config.cdrSync.sourceTable,
      processedStatus: {
        pending: Number(config.cdrSync.processedStatus?.pending ?? 0),
        success: Number(config.cdrSync.processedStatus?.success ?? 1)
      },
      pollIntervalSeconds: Number(config.cdrSync.pollIntervalSeconds || 30),
      fileTransfer: {
        enabled: config.fileTransfer?.enabled ?? false,
        protocol: (config.fileTransfer?.protocol || "SFTP").toUpperCase(),
        intervalSeconds: Number(config.fileTransfer?.intervalSeconds || 600)
      },
    },
    databases: databases.map((database) => ({
      mysqlDb: database.mysqlDb,
      oracleClient: database.oracleClient || {},
      oracleDb: database.oracleDb
    })),
    mysqlDb: databases[0].mysqlDb,
    oracleClient: databases[0].oracleClient || {},
    oracleDb: databases[0].oracleDb
  };
}

function resolveEnvValues(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      resolveEnvValues(item);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      value[key] = resolveEnvString(entry);
    } else {
      resolveEnvValues(entry);
    }
  }
}

function resolveEnvString(value) {
  const match = value.match(/^\$\{([A-Z0-9_]+)\}$/);
  if (!match) {
    return value;
  }

  const envValue = process.env[match[1]];
  if (envValue === undefined) {
    throw new Error(`Missing environment variable: ${match[1]}`);
  }

  return envValue;
}

module.exports = { readRuntimeConfig };
