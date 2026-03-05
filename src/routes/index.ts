import { Router } from "express";

const router = Router();

router.get("/", (req, res) => {
  res.json({ message: "API is running" });
});

export default router;