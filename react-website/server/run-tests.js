const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

function waitForServer(url, timeoutMs = 15000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      http.get(url, (res) => {
        clearInterval(interval);
        resolve();
      }).on("error", () => {
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(interval);
          reject(new Error("Timeout waiting for server to start."));
        }
      });
    }, 500);
  });
}

async function main() {
  console.log("Starting server.js process...");
  const serverProc = spawn("node", ["server.js"], {
    cwd: __dirname,
    stdio: "inherit"
  });

  try {
    await waitForServer("http://localhost:3000/");
    console.log("Server is listening on port 3000. Running tests...");

    const testProc = spawn("node", ["test-integration.js"], {
      cwd: __dirname,
      stdio: "inherit"
    });

    testProc.on("close", (code) => {
      serverProc.kill();
      process.exit(code);
    });
  } catch (err) {
    console.error("Test runner failed:", err);
    serverProc.kill();
    process.exit(1);
  }
}

main();
