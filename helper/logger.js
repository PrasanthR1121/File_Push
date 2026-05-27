const fs = require("fs");
const path = require("path");
const util = require("util");
const { readRuntimeConfig } = require("../src/runtimeConfig");

const config = readRuntimeConfig();
const baseLogDir = path.resolve(process.cwd(), config.log?.path || "./logs");

const today = new Date();
const folderDay = String(today.getDate()).padStart(2, "0");
const folderMonth = String(today.getMonth() + 1).padStart(2, "0"); 
const folderYear = today.getFullYear();
const dateFolderName = `${folderDay}-${folderMonth}-${folderYear}`;

const logDir = path.join(baseLogDir, dateFolderName);

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const errorLogStream = fs.createWriteStream(path.join(logDir, "error.log"), { flags: "a" });
const appLogStream = fs.createWriteStream(path.join(logDir, "app.log"), { flags: "a" });

function formatMessage(level, message, ...args) {
  const now = new Date();
  
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const milliseconds = String(now.getMilliseconds()).padStart(3, "0");

  const timestamp = `${day}-${month}-${year} ${hours}:${minutes}:${seconds}.${milliseconds}`;
  
  const formattedMessage = util.format(message, ...args);
  return `[${timestamp}] [${level.toUpperCase()}] ${formattedMessage}\n`;
}

const logger = {
  info: (message, ...args) => {
    const output = formatMessage("info", message, ...args);
    process.stdout.write(output);
    appLogStream.write(output);
  },
  warn: (message, ...args) => {
    const output = formatMessage("warn", message, ...args);
    process.stdout.write(output);
    appLogStream.write(output);
  },
  error: (message, ...args) => {
    const output = formatMessage("error", message, ...args);
    process.stderr.write(output);
    errorLogStream.write(output);
  }
};

module.exports = logger;