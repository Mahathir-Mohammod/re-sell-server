import { z } from "zod";

// Every field optional: the form sends only what changed.
export const updateMeSchema = {
  body: z
    .object({
      name: z.string().trim().min(2, "Name is too short").max(80).optional(),
      phone: z.string().trim().max(30).optional(),
      location: z.string().trim().max(80).optional(),
      bio: z.string().trim().max(500).optional(),
      image: z.string().trim().url("Photo must be a URL").max(500).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update" }),
};
