import { generateStaticSecurityConfig } from "./static-security-contract.mjs";

const { hashes, release } = await generateStaticSecurityConfig();
process.stdout.write(`Pinned ${hashes.length} inline script hashes and service-worker release ${release.version}.\n`);
