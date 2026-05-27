const fs = require("fs");
const path = require("path");
const oracledb = require("oracledb");
const { getOracleConnection } = require("./oracle");
const { uploadFile } = require("./transport");
const logger = require("../helper/logger");

async function runFileTransfer(runtimeConfig) {
    let connection;

    try {
        connection = await getOracleConnection(runtimeConfig.oracleDb, runtimeConfig.oracleClient);

        const result = await connection.execute(
            `BEGIN 
                Bsp_Sftp_Get_Files_to_Transfer_Prc(:flag, :host, :port, :user, :pass, :cursor); 
             END;`,
            {
                flag: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
                host: { type: oracledb.STRING, dir: oracledb.BIND_OUT },
                port: { type: oracledb.STRING, dir: oracledb.BIND_OUT },
                user: { type: oracledb.STRING, dir: oracledb.BIND_OUT },
                pass: { type: oracledb.STRING, dir: oracledb.BIND_OUT },
                cursor: { type: oracledb.CURSOR, dir: oracledb.BIND_OUT }
            }
        );

        const flag = result.outBinds.flag;

        if (flag !== 1) {
            logger.info(`[FileTransfer] No files available for transmission (Flag: ${flag}).`);
            if (result.outBinds.cursor) await result.outBinds.cursor.close();
            return;
        }

        const portNumber = Number(result.outBinds.port || 22);
        const configuredProtocol = runtimeConfig.fileTransfer?.protocol || (portNumber === 22 ? "SFTP" : "FTP");

        const transportConfig = {
            enabled: true,
            protocol: configuredProtocol,
            host: result.outBinds.host,
            port: portNumber,
            user: result.outBinds.user,
            password: result.outBinds.pass
        };

        const resultSet = result.outBinds.cursor;
        let row;

        while ((row = await resultSet.getRow())) {
            const [fileId, sourcePath, destPath, backupPath] = row;

            const fileName = path.basename(sourcePath);

            logger.info(`[FileTransfer] Processing File ID ${fileId}: ${fileName}`);

            if (!fs.existsSync(sourcePath)) {
                logger.error(`[FileTransfer] Local source file does not exist: ${sourcePath}`);
                await updateStatus(connection, fileId, 9);
                continue;
            }

            try {
                const normalizedDestDir = destPath.endsWith("/") ? destPath : `${destPath}/`;
                const finalRemotePath = `${normalizedDestDir}${fileName}`;

                logger.info(`[FileTransfer] Uploading file to target path: ${finalRemotePath}`);

                await uploadFile(sourcePath, finalRemotePath, transportConfig);

                let finalBackupPath = backupPath;
                if (backupPath.endsWith("\\") || backupPath.endsWith("/") || !path.extname(backupPath)) {
                    finalBackupPath = path.join(backupPath, fileName);
                }

                const backupDir = path.dirname(finalBackupPath);
                if (!fs.existsSync(backupDir)) {
                    fs.mkdirSync(backupDir, { recursive: true });
                }

                fs.renameSync(sourcePath, finalBackupPath);

                await updateStatus(connection, fileId, 1);
                logger.info(`[FileTransfer] File ID ${fileId} successfully delivered and moved to backup path.`);

            }
            catch (transferError) {
                logger.error(`[FileTransfer] Transmission failed for File ID ${fileId}: ${transferError.message}`);
                await updateStatus(connection, fileId, 9);
            }
        }

        await resultSet.close();

    } catch (err) {
        logger.error(`[FileTransfer] Engine execution failure: ${err.message}`);
    } finally {
        if (connection) { try { await connection.close(); } catch (_) { } }
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
    const { readRuntimeConfig } = require("./runtimeConfig");
    const runtimeConfig = readRuntimeConfig();
    runFileTransfer(runtimeConfig).catch(err => {
        logger.error("Direct execution crashed:", err);
        process.exit(1);
    });
}