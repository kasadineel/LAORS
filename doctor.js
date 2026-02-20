import net from "net";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  console.log("❌ No DATABASE_URL or DIRECT_URL found.");
  process.exit(1);
}

const hostMatch = url.match(/@([^:]+):/);
const host = hostMatch?.[1];

if (!host) {
  console.log("❌ Could not parse DB host from URL.");
  process.exit(1);
}

console.log("Checking Supabase host:", host);

const socket = new net.Socket();
socket.setTimeout(3000);

socket.on("connect", () => {
  console.log("✅ Port 5432 reachable.");
  socket.destroy();
  process.exit(0);
});

socket.on("error", () => {
  console.log("❌ Cannot reach port 5432.");
  console.log("Likely causes:");
  console.log("- Supabase project paused");
  console.log("- Campus WiFi blocking port 5432");
  console.log("- Bad connection string");
  process.exit(1);
});

socket.on("timeout", () => {
  console.log("❌ Connection timed out.");
  process.exit(1);
});

socket.connect(5432, host);