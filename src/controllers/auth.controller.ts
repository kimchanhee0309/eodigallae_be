import type { RequestHandler } from "express";

import { AppError } from "../errors/AppError.js";
import { signupLocalUser } from "../services/auth.service.js";
import { localSignupSchema } from "../validators/auth.schema.js";

export const signupController: RequestHandler = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!req.is("application/json")) {
    throw new AppError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type은 application/json이어야 합니다.",
    );
  }

  const input = localSignupSchema.parse(req.body);
  const user = await signupLocalUser(input);

  res.status(201).json({
    data: {
      user,
    },
  });
};
