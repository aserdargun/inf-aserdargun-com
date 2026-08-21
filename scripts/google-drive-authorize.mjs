import { runDriveReleaseEntrypoint } from "./google-drive-release.mjs";

const help = "Usage: node scripts/google-drive-authorize.mjs\nReads OAuth client configuration from ignored .env.local and writes the verified refresh credential back atomically.\n";

if (process.argv.length > 2) {
  if (process.argv.length === 3 && ["--help", "help"].includes(process.argv[2])) process.stdout.write(help);
  else { process.stderr.write(help); process.exitCode = 1; }
} else {
  runDriveReleaseEntrypoint("authorize").catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
