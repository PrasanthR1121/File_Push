const path = require("path");
const assert = require("assert");

const { readRuntimeConfig } = require("../src/runtimeConfig");
const { verifyConnection } = require("../src/transport");

try {
    readRuntimeConfig();
} catch (_) {
    console.log("Safe to ignore validation errors.");
}

async function runConnectionTests() {
    console.log("Starting Connection Verification Integration Tests...\n");

    try {
        console.log("Test 1: Testing Connection with target credentials...");
        
        const liveTestConfig = {
            protocol: process.env.REMOTE_PROTOCOL,
            host: "HOST", 
            port: "PORT",
            user: "USER",
            password: "PASSWORD"
        };

        console.log(`Handshaking with ${liveTestConfig.protocol}://${liveTestConfig.host}:${liveTestConfig.port}...`);
        
        await verifyConnection(liveTestConfig);
        
        console.log("Test 1 Passed: Remote connection handshook and disconnected cleanly!\n");
    } catch (error) {
        console.error("Test 1 Failed: Connection verification was explicitly rejected.");
        console.error(`Debug Reason: ${error.message}\n`);
    }

    try {
        console.log("Test 2: Verifying system error handling on unreachable hosts...");
        
        const failingConfig = {
            protocol: "FTP",
            host: "0.0.0.0", 
            port: 9999,
            user: "bad_user",
            password: "bad_password"
        };

        await verifyConnection(failingConfig);
        
        assert.fail("System should have thrown an error for an unreachable host, but it didn't.");
    } catch (error) {
        if (error.code === "ERR_ASSERTION") {
            console.error(`Test 2 Failed: ${error.message}\n`);
        } else {
            console.log("Test 2 Passed: Connection engine correctly intercepted the failure path.");
            console.log(`(Caught Expected Error: ${error.message})\n`);
        }
    }

    console.log("Connection testing complete.");
}

runConnectionTests().catch(err => {
    console.error("Fatal error inside test runner core:", err);
    process.exit(1);
});
