const ftp = require("basic-ftp");
const sftpClient = require("ssh2-sftp-client");
const path = require("path");
const logger = require("../helper/logger");

async function uploadFile(localPath, remotePath, config) {
    const protocol = config.protocol.toUpperCase();
    const remoteDir = path.posix.dirname(remotePath);

    if (protocol === "SFTP") {
        await uploadSftp(localPath, remotePath, remoteDir, config);
    } else if (protocol === "FTP" || protocol === "FTPS") {
        await uploadFtp(localPath, remotePath, remoteDir, config, protocol === "FTPS");
    } else {
        throw new Error(`Invalid protocol: ${protocol}`);
    }
}

async function uploadFtp(localPath, remotePath, remoteDir, config, secure) {
    const client = new ftp.Client();
    try {
        await client.access({
            host: config.host,
            port: Number(config.port) || 21,
            user: config.user,
            password: config.password,
            secure: secure
        });

        if (remoteDir && remoteDir !== ".") await client.ensureDir(remoteDir);
        await client.uploadFrom(localPath, path.posix.basename(remotePath));
        logger.info(`Uploaded ${path.basename(localPath)} via FTP.`);
    } catch (err) {
        logger.error(`FTP upload failed for ${path.basename(localPath)}: ${err.message}`);
        throw err;
    } finally {
        client.close();
    }
}

async function uploadSftp(localPath, remotePath, remoteDir, config) {
    const client = new sftpClient();
    try {
        await client.connect({
            host: config.host,
            port: Number(config.port) || 22,
            username: config.user,
            password: config.password
        });

        if (remoteDir && remoteDir !== ".") await client.ensureDir(remoteDir);
        await client.put(localPath, remotePath);
        logger.info(`Uploaded ${path.basename(localPath)} via SFTP.`);
    } catch (err) {
        logger.error(`SFTP upload failed for ${path.basename(localPath)}: ${err.message}`);
        throw err;
    } finally {
        await client.end();
    }
}

async function verifyConnection(config) {
    const protocol = config.protocol.toUpperCase();
    if (protocol === "SFTP") {
        const client = new sftpClient();
        try {
            await client.connect({
                host: config.host,
                port: Number(config.port) || 22,
                username: config.user,
                password: config.password
            });
        } finally {
            await client.end();
        }
    } else {
        const client = new ftp.Client();
        try {
            await client.access({
                host: config.host,
                port: Number(config.port) || 21,
                user: config.user,
                password: config.password,
                secure: protocol === "FTPS"
            });
        } finally {
            client.close();
        }
    }
}

module.exports = { uploadFile, verifyConnection };

