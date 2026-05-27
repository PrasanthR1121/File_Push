{
  "log": {
    "path": "./logs"
  },
  "cdrSync": {
    "enabled": true,
    "batchSize": 10000,
    "sourceTable": "SOURCE_TABLE",
    "targetTable": "TARGET_TABLE",
    "controlTable": "CONTROL_TABLE",
    "controlDescription": "DESCRIPTION",
    "processedStatus": {
      "pending": 0,
      "success": 1
    },
    "pollIntervalSeconds": 5
  },
  "database": [
    {
      "mysqlDb": {
        "host": "${MYSQL_HOST}",
        "port": 3306,
        "user": "${MYSQL_USER}",
        "password": "${MYSQL_PASSWORD}",
        "database": "${MYSQL_DATABASE}",
        "waitForConnections": true,
        "multipleStatements": true,
        "namedPlaceholders": true,
        "connectionLimit": 10,
        "queueLimit": 10000
      },
      "oracleClient": {
        "libDir": "${ORACLE_CLIENT_LIB_DIR}",
        "tnsAdmin": "${ORACLE_TNS_ADMIN}"
      },
      "oracleDb": {
        "user": "${ORACLE_USER}",
        "password": "${ORACLE_PASSWORD}",
        "connectString": "${ORACLE_CONNECT_STRING}"
      }
    }
  ],
  "fileTransfer": {
    "enabled": true,
    "protocol": "${REMOTE_PROTOCOL}",
    "intervalSeconds": 600
  }
}
