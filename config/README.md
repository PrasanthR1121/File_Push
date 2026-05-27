# Runtime Config

Use `APP_ENV=dev` or `APP_ENV=prod` to choose the runtime config:

```powershell
$env:APP_ENV="dev"; 
npm start

$env:APP_ENV="prod"; 
npm satrt

(Note: npm start automatically defaults to the continuous sync-cdr command).
```

The sync process reads from MySQL `acp.bsp_cdr_details_mst`, writes rows into Oracle in batches, marks successful MySQL rows using `processed_status`, and updates Oracle `control_table.Cntrl_Id` to the highest successfully inserted MySQL `id`.

Config files:

- `config.dev.json` for development
- `config.prod.json` for production

Passwords should be provided through environment variables referenced as `${MYSQL_PASSWORD}`, `${ORACLE_PASSWORD}`, and similar placeholders in the config.

For live load:

```powershell
$env:APP_ENV="prod"
pm2 start vibsp.config.js
pm2 save
```

The syncing repeats every `cdrSync.pollIntervalSeconds`. Each cycle processes one batch per configured database entry. 