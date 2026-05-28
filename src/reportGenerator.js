require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const oracledb = require("oracledb");

const { getOracleConnection } = require("./oracle");
const logger = require("../helper/logger");
const { readRuntimeConfig } = require("./runtimeConfig");

const textColumns = [
    "WABA_NUMBER",
    "DESTINATION_MSISDN",
    "A_PARTY_MSISDN",
    "B_PARTY_MSISDN"
];

function getFormattedDateString() {

    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

const runtimeConfig = readRuntimeConfig();

async function runReportGenerator(runtimeConfig) {

    const report = runtimeConfig.report;
    const dbConfig = runtimeConfig.databases[0];

    const reportDir = path.resolve(
        process.cwd(),
        report.path || "./reports"
    );

    if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
    }

    let oracleConnection;

    try {

        oracleConnection = await getOracleConnection(
            dbConfig.oracleDb,
            dbConfig.oracleClient
        );

        const controlTable =
            report.controlTable || "bsp_control_table";

        const controlRowId =
            report.controlRowId ?? 2;

        const targetTable =
            runtimeConfig.cdrSync.targetTable;

        const maxRowsPerFile =
            report.maxRowsPerFile || 25000;

        const maxRowsFetch =
            report.maxRowsFetch || 100000;

        const controlResult = await oracleConnection.execute(
            `SELECT CNTRL_ID
             FROM ${controlTable}
             WHERE ID = :id
               AND ROWNUM = 1`,
            { id: controlRowId }
        );

        const lastExportedId = Number(
            controlResult.rows?.[0]?.[0] ?? 0
        );

        logger.info(
            `Last exported CDR_ID: ${lastExportedId}`
        );

        const dataResult = await oracleConnection.execute(
            `SELECT *
             FROM ${targetTable}
             WHERE CDR_ID > :lastId
             ORDER BY CDR_ID ASC
             FETCH FIRST ${maxRowsFetch} ROWS ONLY`,
            { lastId: lastExportedId },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const rows = dataResult.rows || [];

        logger.info(`Fetched ${rows.length} rows.`);

        if (rows.length === 0) {

            logger.info("No new CDR records found.");

            return {
                processed: 0,
                files: []
            };
        }

        const totalFiles = Math.ceil(
            rows.length / maxRowsPerFile
        );

        const generatedFiles = [];

        const dateString = getFormattedDateString();

        for (let i = 0; i < totalFiles; i++) {

            const start = i * maxRowsPerFile;
            const end = start + maxRowsPerFile;

            const chunkRows = rows
                .slice(start, end)
                .map(row => ({ ...row }));

            const workbook = new ExcelJS.Workbook();

            const sheet = workbook.addWorksheet(
                "ViBSP CDR Report"
            );

            const columns = Object.keys(chunkRows[0]).map(key => ({
                header: key,
                key
            }));

            sheet.columns = columns;

            sheet.views = [
                {
                    state: "frozen",
                    ySplit: 1
                }
            ];

            sheet.getRow(1).font = {
                bold: true
            };

            sheet.columns.forEach(column => {

                if (textColumns.includes(column.key)) {
                    column.numFmt = "@";
                }
            });

            chunkRows.forEach(row => {

                textColumns.forEach(column => {

                    if (
                        row[column] !== null &&
                        row[column] !== undefined
                    ) {
                        row[column] = String(row[column]);
                    }
                });
            });

            sheet.addRows(chunkRows);

            sheet.columns.forEach(column => {

                let maxLength = 10;

                column.eachCell?.(
                    { includeEmpty: true },
                    cell => {

                        const cellValue =
                            cell.value !== null &&
                            cell.value !== undefined
                                ? cell.value.toString()
                                : "";

                        maxLength = Math.max(
                            maxLength,
                            cellValue.length
                        );
                    }
                );

                column.width = Math.min(
                    maxLength + 2,
                    50
                );
            });

            const sequence = String(i + 1)
                .padStart(4, "0");

            const fileName =
                `${report.fileNamePrefix}` +
                `${dateString}_${sequence}.xlsx`;

            const filePath = path.join(
                reportDir,
                fileName
            );

            await workbook.xlsx.writeFile(filePath);

            generatedFiles.push(fileName);

            logger.info(
                `Generated ${fileName} with ${chunkRows.length} rows.`
            );
        }

        const maxCdrId = rows.reduce(
            (maxId, row) => {

                const cdrId = Number(row.CDR_ID);

                return cdrId > maxId
                    ? cdrId
                    : maxId;

            },
            lastExportedId
        );

        // Update control table
        await oracleConnection.execute(
            `UPDATE ${controlTable}
             SET CNTRL_ID = :controlId
             WHERE ID = :id`,
            {
                controlId: maxCdrId,
                id: controlRowId
            },
            { autoCommit: false }
        );

        await oracleConnection.commit();

        logger.info(
            `Updated control table with CDR_ID ${maxCdrId}`
        );

        return {
            processed: rows.length,
            files: generatedFiles,
            lastCdrId: maxCdrId
        };

    } catch (error) {

        if (oracleConnection) {

            try {
                await oracleConnection.rollback();
            } catch (_) {}
        }

        logger.error(
            "Report generation failed:",
            error
        );

        throw error;

    } finally {

        if (oracleConnection) {

            try {
                await oracleConnection.close();
            } catch (_) {}
        }
    }
}

module.exports = {
    runReportGenerator
};

if (require.main === module) {
  
    runReportGenerator(runtimeConfig)
        .then(result => {

            console.log(
                "Report completed:",
                result
            );
        })
        .catch(error => {

            console.error(
                "Report failed:",
                error
            );
        });
}
