// BoA × Arc — app backend entry. `node index.ts` (Node 22 runs TS directly).
import { buildApp } from "./src/server.ts";

const PORT = Number(process.env.PORT || 8080);
buildApp().listen(PORT, "0.0.0.0", () => {
  console.log(`boa-arc-service (app API) on :${PORT}`);
});
