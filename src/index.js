const { readRuntimeConfig } = require("./runtimeConfig");
const { runCdrSync } = require("./cdrSync");
const { runReconciliation } = require("./reconciliation");
const { testConnections } = require("./conncectionCheck");
const { runFileTransfer } = require("./fileTransfer");
const logger = require("../helper/logger");

async function main() {
  const command = process.argv[2] || "sync-cdr";

  // ─── CONNECTION TESTING ──────────────────────────────────────────
  if (command === "check-connections") {
    const runtimeConfig = readRuntimeConfig();
    const results = await testConnections(runtimeConfig);

    for (const result of results) {
      logger.info(
        `[${runtimeConfig.envName}] OK MySQL=${result.mysqlDatabase}, Oracle=${result.oracleConnectString}`
      );
    }
    return;
  }

  // ─── DATA SYNC ENGINE ──────────────────────────────────────────
  if (command === "sync-cdr") {
    const runtimeConfig = readRuntimeConfig();

    logger.info(
      `[${runtimeConfig.envName}] CDR sync started. Poll interval: ${runtimeConfig.cdrSync.pollIntervalSeconds}s`
    );

    const runWatcher = async () => {
      try {
        const result = await runCdrSync(runtimeConfig);

        if (result.processed > 0) {
          logger.info(
            `[${runtimeConfig.envName}] CDR sync processed ${result.processed} row(s). Control id: ${result.controlId}`
          );
        }

        const delay = result.processed > 0
          ? 200
          : runtimeConfig.cdrSync.pollIntervalSeconds * 1000;

        setTimeout(runWatcher, delay);

      } catch (error) {
        logger.error(`[${runtimeConfig.envName}] Sync error:`, error.message);
        setTimeout(runWatcher, runtimeConfig.cdrSync.pollIntervalSeconds * 1000);
      }
    };

    await runWatcher();
    return;
  }

  // ─── DATA RECONCILIATION AUDITOR ──────────────────────────────────────────
  if (command === "cdr-reconcile") {
    const runtimeConfig = readRuntimeConfig();
    const hourlyIntervalMs = 60 * 60 * 1000;

    logger.info(`[${runtimeConfig.envName}] Reconciliation daemon worker engine started. Interval: 1 hour`);

    const runWatcher = async () => {
      try {
        await runReconciliation();
      } catch (error) {
        logger.error(`[${runtimeConfig.envName}] Reconciliation daemon watcher error:`, error.message);
      } finally {
        setTimeout(runWatcher, hourlyIntervalMs);
      }
    };

    await runWatcher();
    return;
  }

  // ─── CDR REPORT GENERATION ──────────────────────────────────────────
  if (command === "cdr-reports") {
    const runtimeConfig = readRuntimeConfig();
    const intervalMs = (runtimeConfig.report.pollIntervalMinutes || 10) * 60 * 1000;

    logger.info(`[${runtimeConfig.envName}] Report generator started. Interval: ${runtimeConfig.report.pollIntervalMinutes}m`);

    const runReport = async () => {
      try {
        await runReportGenerator(runtimeConfig);
      } catch (error) {
        logger.error(`[${runtimeConfig.envName}] Report error:`, error.message);
      } finally {
        setTimeout(runReport, intervalMs); 
      }
    };

    await runReport();
    return;
  }

  // ─── FTP/SFTP FILE TRANSMISSION ENGINE ──────────────────────────────────────────
  if (command === "file-move") {
    const runtimeConfig = readRuntimeConfig();
    const intervalSeconds = runtimeConfig.fileTransfer?.intervalSeconds || 600;

    logger.info(`[${runtimeConfig.envName}] FTP/SFTP File Transfer Engine started. Polling every ${intervalSeconds} seconds.`);

    const runWatcher = async () => {
      try {
        await runFileTransfer(runtimeConfig);
      } catch (error) {
        logger.error(`[${runtimeConfig.envName}] File transfer engine watcher error:`, error.message);
      } finally {
        setTimeout(runWatcher, intervalSeconds * 1000);
      }
    };

    await runWatcher();
    return;
  }

  logger.error(`Unknown command: ${command}`);
}

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception thrown:", error);
  process.exitCode = 1;
});

main().catch((error) => {
  logger.error("Fatal error in main execution:", error);
  process.exitCode = 1;
});
