const { createPool } = require("./mysql");
const { getOracleConnection } = require("./oracle");
const logger = require("../helper/logger");
const { readRuntimeConfig } = require("./runtimeConfig");

const runtimeConfig = readRuntimeConfig();

const COLUMN_MAPPING = {
  id: "ACP_MAP_ID",
  event_id: "EVENT_ID",
  event_type: "EVENT_TYPE",
  event_timestamp: "EVENT_TIMESTAMP",
  bsp_id: "BSP_ID",
  tsp_id: "TSP_ID",
  operator_id: "OPERATOR_ID",
  enterprise_id: "ENTERPRISE_ID",
  waba_number: "WABA_NUMBER",
  billing_type: "BILLING_TYPE",
  destination_msisdn: "DESTINATION_MSISDN",
  conversation_mode: "CONVERSATION_MODE",
  conversation_category: "CONVERSATION_CATEGORY",
  country_code: "COUNTRY_CODE",
  credits: "CREDITS",
  status: "MESSAGE_INFO_STATUS",
  message_id: "MESSAGE_ID"
};

function mysqlIdentifier(name) {
  return `\`${String(name).replace(/`/g, "``")}\``;
}

const columns = Object.keys(COLUMN_MAPPING)
  .map(mysqlIdentifier)
  .join(", ");

function mysqlQualifiedIdentifier(name) {
  return String(name)
    .split(".")
    .map(mysqlIdentifier)
    .join(".");
}

function oracleIdentifier(name) {
  return String(name).replace(/[^A-Za-z0-9_$#]/g, "").toUpperCase();
}

function oracleQualifiedIdentifier(name) {
  return String(name)
    .split(".")
    .map(oracleIdentifier)
    .join(".");
}

function oracleDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  return new Date(String(value).replace(" ", "T"));
}

// ─── MySQL ────────────────────────────────────────────────────────────────────

async function fetchPendingRows(mysqlPool, settings, controlId) {
  const tableName = mysqlQualifiedIdentifier(settings.sourceTable);

  const safeLookBackId = Math.max(0, controlId - 100000);

  const [rows] = await mysqlPool.query(
    `SELECT ${columns}
     FROM ${tableName}
     WHERE id > ?
       AND COALESCE(processed_status, 0) = ?
     ORDER BY id ASC
     LIMIT ?`,
    [safeLookBackId, settings.processedStatus.pending, settings.batchSize]
  );

  return rows;
}

async function markRowsProcessed(mysqlPool, settings, rows, status) {
  if (rows.length === 0) return;

  const ids = rows.map((row) => row.id);
  await mysqlPool.query(
    `UPDATE ${mysqlQualifiedIdentifier(settings.sourceTable)}
     SET processed_status = ?
     WHERE id IN (?)`,
    [status, ids]
  );
}

// ─── Oracle ───────────────────────────────────────────────────────────────────

async function getOracleControlId(oracleConnection, settings) {
  const controlTable = oracleQualifiedIdentifier(settings.controlTable);
  const rowId = Number(settings.controlRowId || 1);

  const result = await oracleConnection.execute(
    `SELECT CNTRL_ID
     FROM (SELECT CNTRL_ID FROM ${controlTable} 
     WHERE ID = :id)
     WHERE ROWNUM = 1`,
    { id: rowId }
  );

  return Number(result.rows?.[0]?.[0] || 0);
}

async function updateOracleControlId(oracleConnection, settings, controlId) {
  const controlTable = oracleQualifiedIdentifier(settings.controlTable);
  const rowId = Number(settings.controlRowId || 1);

  const result = await oracleConnection.execute(
    `UPDATE ${controlTable} 
     SET CNTRL_ID = :controlId 
     WHERE ID = :id`,
    { controlId, id: rowId },
    { autoCommit: false }
  );

  if (result.rowsAffected === 0) {
    await oracleConnection.execute(
      `INSERT INTO ${controlTable} 
      (ID, CNTRL_ID, DESCRIPTION)
      VALUES (:id, :controlId, :description)`,
      { id: rowId, controlId, description: settings.controlDescription },
      { autoCommit: false }
    );
  }
}

function toOracleBind(row) {
  const bind = {};

  for (const [mysqlColumn, oracleColumn] of Object.entries(COLUMN_MAPPING)) {
    let value = row[mysqlColumn];

    if (mysqlColumn === "event_timestamp") {
      value = oracleDate(value);
    } 

    else if (typeof value === "string") {
      value = value.trim();

      if (value === "") {
        value = null;
      }
    }

    bind[oracleColumn] = value;
  }

  return bind;
}

async function insertOracleRows(oracleConnection, settings, rows) {
  if (rows.length === 0) return;

  const targetTable = oracleQualifiedIdentifier(settings.targetTable);
  const targetColumns = Object.values(COLUMN_MAPPING).map(oracleIdentifier);
  const bindParams = targetColumns.map((col) => `:${col}`);

  const sql = `INSERT /*+ IGNORE_ROW_ON_DUPKEY_INDEX(${targetTable}, BSP_INDX_ACP_MAP_ID) */ 
               INTO ${targetTable} (CDR_ID, ${targetColumns.join(", ")})
               VALUES (BSP_CDR_SEQ.NEXTVAL, ${bindParams.join(", ")})`;

  const result = await oracleConnection.executeMany(
    sql,
    rows.map(toOracleBind),
    { autoCommit: false, batchErrors: false }
  );

  const insertedInOracle = result.rowsAffected || 0;
  const skipped = rows.length - insertedInOracle;

  if (skipped > 0) {
    logger.warn(`[${runtimeConfig.envName}] insertOracleRows: ${insertedInOracle} inserted, ${skipped} skipped (duplicates)`);
  }
}

// ─── Connection Helpers ───────────────────────────────────────────────────────

async function openConnections(databaseConfig) {
  const mysqlPool = createPool(databaseConfig.mysqlDb);
  const oracleConnection = await getOracleConnection(
    databaseConfig.oracleDb,
    databaseConfig.oracleClient
  );
  return { mysqlPool, oracleConnection };
}

async function closeConnections({ mysqlPool, oracleConnection }) {
  try { await oracleConnection.close(); } catch (_) { }
  try { await mysqlPool.end(); } catch (_) { }
}

async function runSingleCdrSync(runtimeConfig, databaseConfig) {
  const settings = runtimeConfig.cdrSync;

  const { mysqlPool, oracleConnection } = await openConnections(databaseConfig);

  try {
    const controlId = await getOracleControlId(oracleConnection, settings);

    const rows = await fetchPendingRows(mysqlPool, settings, controlId);

    if (rows.length === 0) {
      return { processed: 0, controlId };
    }

    await insertOracleRows(oracleConnection, settings, rows);

    const batchMaxId = Math.max(...rows.map((row) => Number(row.id)));
    const newControlId = Math.max(controlId, batchMaxId);

    await markRowsProcessed(mysqlPool, settings, rows, settings.processedStatus.success);

    await updateOracleControlId(oracleConnection, settings, newControlId);
    await oracleConnection.commit();

    return { processed: rows.length, controlId: newControlId };

  } catch (error) {
    try { await oracleConnection.rollback(); } catch (_) { }
    throw error;

  } finally {
    await closeConnections({ mysqlPool, oracleConnection });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function getDatabases(runtimeConfig) {
  return runtimeConfig.databases || [
    {
      mysqlDb: runtimeConfig.mysqlDb,
      oracleDb: runtimeConfig.oracleDb,
      oracleClient: runtimeConfig.oracleClient
    }
  ];
}

async function runCdrSync(runtimeConfig) {
  const databases = getDatabases(runtimeConfig);
  const results = [];

  for (const databaseConfig of databases) {
    const result = await runSingleCdrSync(runtimeConfig, databaseConfig);
    results.push({
      mysqlDatabase: databaseConfig.mysqlDb.database,
      ...result
    });
  }

  return {
    processed: results.reduce((sum, r) => sum + r.processed, 0),
    controlId: results[results.length - 1]?.controlId || 0,
    results
  };
}

module.exports = { runCdrSync };