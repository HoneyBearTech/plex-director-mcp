import { Router } from "express";
import { askMovieAssistant } from "../chat.js";
import { getErrorMessage } from "../../util.js";

export const chatRouter = Router();

chatRouter.post("/movies", async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  try {
    const answer = await askMovieAssistant(question);
    res.json(answer);
  } catch (error) {
    res.status(502).json({ error: getErrorMessage(error) });
  }
});
