import { PublicShell } from "../components/public-shell";
import { PublicViewRoute } from "../features/public-view/public-view-route";

// The site root intentionally opens to the public collection: anonymous
// visitors land on the curated gallery, and signed-in owners reach the admin
// shell from the wordmark or the "Admin sign in" entrypoint. Sharing this
// surface also keeps SSR identical between "/" and "/view/".
export default function HomePage() { return <PublicShell><PublicViewRoute /></PublicShell>; }
