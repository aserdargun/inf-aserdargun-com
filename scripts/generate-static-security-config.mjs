import { generateStaticSecurityConfig } from "./static-security-contract.mjs";

const { hashes } = await generateStaticSecurityConfig();
process.stdout.write(`Pinned ${hashes.length} inline script hashes in out/staticwebapp.config.json.\n`);
