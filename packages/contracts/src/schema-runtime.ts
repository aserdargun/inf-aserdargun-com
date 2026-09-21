import { z } from "zod";

// Configure before constructing any shared schema. Even a caught Function()
// feature probe emits a CSP violation in Firefox under our strict script-src.
// Server-side validation retains JIT; browser validation uses the CSP-safe path.
if (typeof window !== "undefined") z.config({ jitless: true });

export { z };
