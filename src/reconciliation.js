const mysql = require("./mysql");
const { getOracleConnection } = require("./oracle");
const { readRuntimeConfig } = require("./runtimeConfig");
const logger = require("../helper/logger");

const runtimeConfig = readRuntimeConfig();

function mysqlIdentifier(name) {
    return `\`${String(name).replace(/`/g, "``")}\``;
}

function mysqlQualifiedIdentifier(name) {
    return String(name).split(".").map(mysqlIdentifier).join(".");
}

function oracleIdentifier(name) {
    return String(name).replace(/[^A-Za-z0-9_$#]/g, "").toUpperCase();
}

function oracleQualifiedIdentifier(name) {
    return String(name).split(".").map(oracleIdentifier).join(".");
}

async function runReconciliation() {
    const settings = runtimeConfig.cdrSync;
    const controlTable = oracleQualifiedIdentifier(settings.controlTable);
    const sourceTable = mysqlQualifiedIdentifier(settings.sourceTable);
    const targetTable = oracleQualifiedIdentifier(settings.targetTable);

    const CHUNK_SIZE = 50000;

    const databases = runtimeConfig.databases || [
        {
            mysqlDb: runtimeConfig.mysqlDb,
            oracleDb: runtimeConfig.oracleDb,
            oracleClient: runtimeConfig.oracleClient
        }
    ];

    for (const databaseConfig of databases) {
        let mysqlPool;
        let oracleConnection;

        try {
            mysqlPool = mysql.createPool(databaseConfig.mysqlDb);
            oracleConnection = await getOracleConnection(databaseConfig.oracleDb, databaseConfig.oracleClient);

            const liveResult = await oracleConnection.execute(
                `SELECT CNTRL_ID FROM ${controlTable} 
                WHERE ID = 1`
            );
            const liveControlId = Number(liveResult.rows?.[0]?.[0] || 0);

            const reconResult = await oracleConnection.execute(
                `SELECT CNTRL_ID FROM ${controlTable} 
                WHERE ID = 2`
            );

            const trueStoredId = Number(reconResult.rows?.[0]?.[0] || 0);

            let lastReconciledId = Math.max(0, trueStoredId - 100000);

            if (lastReconciledId >= liveControlId) {
                logger.info(`[${runtimeConfig.envName}] Reconciliation is already fully caught up to live sync at ID: ${liveControlId}`);
                continue;
            }

            while (lastReconciledId < liveControlId) {
                const startId = lastReconciledId + 1;
                const endId = Math.min(lastReconciledId + CHUNK_SIZE, liveControlId);

                logger.info(`[${runtimeConfig.envName}] Audit execution block running between IDs ${startId} and ${endId}...`);

                const [mysqlRows] = await mysqlPool.query(
                    `SELECT id, processed_status FROM ${sourceTable} 
                    WHERE id BETWEEN ? AND ?`,
                    [startId, endId]
                );

                if (mysqlRows.length > 0) {
                    const oracleResult = await oracleConnection.execute(
                        `SELECT ACP_MAP_ID FROM ${targetTable} 
                        WHERE ACP_MAP_ID BETWEEN :minId AND :maxId`,
                        { minId: startId, maxId: endId },
                        { outFormat: 4002 }
                    );

                    const oracleSet = new Set(oracleResult.rows.map(row => Number(row.ACP_MAP_ID)));
                    const ghostSuccessIds = [];
                    let missingInOracleCount = 0;

                    for (const row of mysqlRows) {
                        const mysqlId = Number(row.id);
                        const existsInOracle = oracleSet.has(mysqlId);
                        const status = Number(row.processed_status ?? 0);

                        if (existsInOracle && status === 0) {
                            ghostSuccessIds.push(mysqlId);
                        }
                        else if (!existsInOracle && status === 1) {
                            missingInOracleCount++;
                            logger.error(`[${runtimeConfig.envName}] CRITICAL: Record ID ${mysqlId} missing in Oracle! Resetting MySQL status to 0.`);

                            await mysqlPool.query(
                                `UPDATE ${sourceTable} 
                                SET processed_status = 0 
                                WHERE id = ?`,
                                [mysqlId]
                            );
                        }
                    }

                    if (ghostSuccessIds.length > 0) {
                        logger.warn(`[${runtimeConfig.envName}] Resolving ${ghostSuccessIds.length} Ghost Successes...`);
                        const chunkSize = 1000;
                        for (let i = 0; i < ghostSuccessIds.length; i += chunkSize) {
                            const chunk = ghostSuccessIds.slice(i, i + chunkSize);
                            await mysqlPool.query(
                                `UPDATE ${sourceTable} 
                                SET processed_status = 1 
                                WHERE id IN (?)`,
                                [chunk]
                            );
                        }
                    }
                }

                await oracleConnection.execute(
                    `UPDATE ${controlTable} 
                    SET CNTRL_ID = :controlId 
                    WHERE ID = 2`,
                    { controlId: endId },
                    { autoCommit: false }
                );

                await oracleConnection.commit();
                lastReconciledId = endId;
            }

            logger.info(`[${runtimeConfig.envName}] Reconciliation engine successfully synchronized up to ID: ${lastReconciledId}`);

        } catch (error) {
            if (oracleConnection) { try { await oracleConnection.rollback(); } catch (_) { } }
            logger.error(`[${runtimeConfig.envName}] Reconciliation execution failure:`, error.message);
            break;
        } finally {
            if (oracleConnection) { try { await oracleConnection.close(); } catch (_) { } }
            if (mysqlPool) { try { await mysqlPool.end(); } catch (_) { } }
        }
    }
}

module.exports = { runReconciliation };

if (require.main === module) {
    runReconciliation().catch(err => {
        logger.error("Direct manual execution failed:", err);
        process.exit(1);
    });
}