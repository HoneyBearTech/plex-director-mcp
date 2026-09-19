import { Router } from "express";
import { getIndexerHealth } from "../../indexers.js";
import { getErrorMessage } from "../../util.js";

export const indexersRouter = Router();

indexersRouter.get("/health", async (_req, res) => {
  try {
    res.json(await getIndexerHealth());
  } catch (error) {
    res.status(502).json({ error: getErrorMessage(error) });
  }
});
