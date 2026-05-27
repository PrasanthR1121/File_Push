const fs = require("fs");
const path = require("path");
const oracledb = require("oracledb");
const { getOracleConnection } = require("../src/oracle");
const logger = require("../helper/logger");

async function runFileTransfer(runtimeConfig) {
    let connection;

    try {
        connection = await getOracleConnection(runtimeConfig.oracleDb, runtimeConfig.oracleClient);

        // 1. Call procedure to get file stream cursor
        const result = await connection.execute(
            `BEGIN 
                Bsp_Sftp_Get_Files_to_Transfer_Prc(:flag, :host, :port, :user, :pass, :cursor); 
             END;`,
            {
                flag:   { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
                host:   { type: oracledb.STRING, dir: oracledb.BIND_OUT },
                port:   { type: oracledb.STRING, dir: oracledb.BIND_OUT },
                user:   { type: oracledb.STRING, dir: oracledb.BIND_OUT },
                pass:   { type: oracledb.STRING, dir: oracledb.BIND_OUT },
                cursor: { type: oracledb.CURSOR, dir: oracledb.BIND_OUT }
            }
        );

        const flag = result.outBinds.flag;
        if (flag !== 1) {
            logger.info(`[FileTransfer] No files available for transmission (Flag: ${flag}).`);
            if (result.outBinds.cursor) await result.outBinds.cursor.close();
            return;
        }

        const resultSet = result.outBinds.cursor;
        let row;

        // 2. Process each file row inside the cursor sequentially
        while ((row = await resultSet.getRow())) {
            const [fileId, sourcePath, destPath, backupPath] = row;
            const fileName = path.basename(sourcePath);
            
            logger.info(`[FileTransfer] Processing File ID ${fileId}: ${fileName}`);

            if (!fs.existsSync(sourcePath)) {
                logger.error(`[FileTransfer] Local source file does not exist: ${sourcePath}`);
                await updateStatus(connection, fileId, 2); 
                continue;
            }

            try {
                // ─── TEMPORARY MOCK TESTING BLOCK ─────────────────────────────────────
                // Creates a local "mock_remote_destination" folder in your project root
                const mockRemoteDir = path.resolve(process.cwd(), "mock_remote_destination");
                if (!fs.existsSync(mockRemoteDir)) {
                    fs.mkdirSync(mockRemoteDir, { recursive: true });
                }
                const localMockDestPath = path.join(mockRemoteDir, fileName);

                // Copy the file locally to simulate the FTP/SFTP transfer flight
                fs.copyFileSync(sourcePath, localMockDestPath);
                logger.info(`[MOCK] Copied ${fileName} locally to mock destination directory.`);
                // ──────────────────────────────────────────────────────────────────────

                // Step B: Calculate execution date and build date-wise subfolder path
                let finalBackupPath = backupPath;

                if (backupPath.endsWith("\\") || backupPath.endsWith("/") || !path.extname(backupPath)) {
                    finalBackupPath = path.join(backupPath, fileName);
                }
                
                const backupDir = path.dirname(finalBackupPath);
                if (!fs.existsSync(backupDir)) {
                    fs.mkdirSync(backupDir, { recursive: true });
                }

                // Step C: Move local file directly to its specified backup destination folder
                fs.renameSync(sourcePath, finalBackupPath);

                // Step D: Report successful delivery status back to Oracle (Status: 1)
                await updateStatus(connection, fileId, 1);
                logger.info(`[FileTransfer] File ID ${fileId} successfully processed and moved to backup: ${dateFolder}/${fileName}`);

            } catch (transferError) {
                logger.error(`[FileTransfer] Transmission failed for File ID ${fileId}: ${transferError.message}`);
                await updateStatus(connection, fileId, 2);
            }
        }

        await resultSet.close();

    } catch (err) {
        logger.error(`[FileTransfer] Engine execution failure: ${err.message}`);
    } finally {
        if (connection) { try { await connection.close(); } catch (_) {} }
    }
}

async function updateStatus(connection, fileId, statusId) {
    try {
        await connection.execute(
            `BEGIN 
                Bsp_Sftp_Get_File_Trans_Status_Prc(:fileId, :statusId); 
             END;`,
            {
                fileId: fileId,
                statusId: statusId
            }
        );
        await connection.commit();
    } catch (err) {
        logger.error(`[FileTransfer] Failed writing status to Oracle for File ID ${fileId}: ${err.message}`);
    }
}

module.exports = { runFileTransfer };

if (require.main === module) {
    const { readRuntimeConfig } = require("../src/runtimeConfig");
    const runtimeConfig = readRuntimeConfig();
    runFileTransfer(runtimeConfig).catch(err => {
        logger.error("Direct execution crashed:", err);
        process.exit(1);
    });
}