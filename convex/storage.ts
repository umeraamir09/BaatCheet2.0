/**
 * Rich messaging — Convex file storage functions.
 *
 * `generateUploadUrl` produces a short-lived (1-hour) URL the client can POST
 * files to directly. The response includes a `storageId` (Id<"_storage">) that
 * the client passes to `sendMessage` as an image attachment.
 */
import { mutation } from "./_generated/server";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});
