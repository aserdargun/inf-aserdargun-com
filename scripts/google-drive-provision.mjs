import { runDriveReleaseEntrypoint } from "./google-drive-release.mjs";

const help = "Usage: node scripts/google-drive-provision.mjs\nReads verified OAuth credentials from ignored .env.local and persists provisioned folder IDs there atomically.\n";

if (process.argv.length > 2) {
  if (process.argv.length === 3 && ["--help", "help"].includes(process.argv[2])) process.stdout.write(help);
  else { process.stderr.write(help); process.exitCode = 1; }
} else {
  runDriveReleaseEntrypoint("provision").catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
