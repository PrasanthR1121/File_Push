module.exports = {
  apps: [
    {
      name: "vibsp-sync",
      script: "./src/index.js",
      args: "sync-cdr",
      instances: 1,
      exec_mode: "fork"
    },
    {
      name: "vibsp-reconcile",
      script: "./src/index.js",
      args: "cdr-reconcile",
      instances: 1,
      exec_mode: "fork"
    },
    {
      name: "vibsp-file-move",
      script: "./src/index.js",
      args: "file-move",
      instances: 1,
      exec_mode: "fork"
    }
  ]
};