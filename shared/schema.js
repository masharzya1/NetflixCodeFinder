import { z } from "zod";

export const insertUserSchema = z.object({
  username: z.string(),
  password: z.string(),
});
