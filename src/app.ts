import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import swaggerUi from "swagger-ui-express";

import routes from "./routes";
import { errorHandler } from "./middleware/errorHandler";
import { swaggerSpec } from "./config/swagger.config";

dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(morgan("dev"));

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use("/api", routes);

app.use(errorHandler);

export default app;
