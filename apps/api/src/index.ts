import { buildApp } from "./server.js";

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 4000);

const app = buildApp();

app.listen({ host, port }).catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});
