# MySQL to Oracle CDR Sync

Basic Node.js service for live syncing data from MySQL to Oracle in batches with reconciliation mechanism and generates reports then pushes reports to the remote server using FTP/SFTP.

## What It Does

1. Connects to MySQL and Oracle using `config/config.dev.json` or `config/config.prod.json`.
2. Reads the control id from the Oracle `control_table`.
3. Fetches up to `batchSize` rows from MySQL `bsp_cdr_details_mst` where `id > control id` and `processed_status` is pending.
4. Batch inserts the rows into the configured Oracle target table using `executeMany`.
5. Updates MySQL `bsp_cdr_details_mst.processed_status = 1` for processed rows.
6. Updates Oracle control table `CNTRL_ID` to the latest processed MySQL `id`.

Oracle insert uses `MERGE` on `ACP_MAP_ID`, so duplicate rows are skipped automatically.

## Config Files

- dev: `config/config.dev.json`
- prod: `config/config.prod.json`

Passwords are not stored directly in config.

$env:MYSQL_USER="${MYSQL_USER}" 
$env:MYSQL_PASSWORD="${MYSQL_PASSWORD}"

$env:ORACLE_USER="${ORACLE_USER}$" 
$env:ORACLE_PASSWORD="${ORACLE_PASSWORD}"
$env:ORACLE_CONNECT_STRING="${ORACLE_CONNECT_STRING}"

$env:REMOTE_PROTOCOL="FTP/SFTP"

## Commands

```powershell
npm install

$env:APP_ENV="dev";
npm run check-connections

$env:APP_ENV="prod"; 
npm run check-connections
```

## Run continuously

```powershell

Development
$env:APP_ENV="dev"
npx pm2 start src/index.js --name "sync-cdr" -- sync-cdr
npx pm2 start src/index.js --name "cdr-reconcile" -- cdr-reconcile
npx pm2 start src/index.js --name "cdr-report" -- file-move
npx pm2 start src/index.js --name "file-move" -- file-move

or

npm start

(Note: npm start automatically defaults to the continuous sync-cdr command).

Production
$env:APP_ENV="prod"
pm2 start vibsp.config.js
pm2 save
```

The batch size is configured as `cdrSync.batchSize`; currently it is `10000`.
