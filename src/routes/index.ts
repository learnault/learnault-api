import { Router } from "express";
import userRoutes from "./v1/users.routes";

const router = Router();

router.get("/", (req, res) => {
  res.json({ message: "API is running" });
});

router.use("/v1/users", userRoutes);

export default router;
