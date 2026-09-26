// ─────────────────────────────────────────────────────
//  Materio MCP Tools — Community, Notebooks & Posts
//  Standardized in 'word_word' format
// ─────────────────────────────────────────────────────

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  fetchCurrentExams,
  updateExamData,
  fetchActivePromotions,
  fetchAllPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
  fetchNotifications,
  createNotification,
  updateNotification,
  deleteNotification,
  fetchUserNotebooks,
  syncUserNotebook,
  deleteUserNotebook,
  fetchInsightroomPosts,
  readInsightroomPost,
} from "../services/materio-api.js";
import {
  type MaterioProtectedUser,
  type AccessTier,
  validateToken,
  checkToolAccess,
} from "../services/materio-auth.js";

// Schemas
const CheckCurrentExamsSchema = {};

const EditExamDataSchema = {
  examData: z.record(z.unknown()).describe("The complete exam configuration object (semesters, schedules, enabled flag)."),
  authToken: z.string().optional().describe("Admin Materio ID token if not supplied via header."),
};

const ActivePromotionsSchema = {};

const ListAllPromotionsSchema = {
  authToken: z.string().optional().describe("Admin Materio ID token if not supplied via header."),
};

const CreatePromotionSchema = {
  title: z.string().describe("Promotion title / headline."),
  description: z.string().describe("Promotion detailed description."),
  enabled: z.boolean().optional().default(true).describe("Whether this promotion is currently active."),
  isLimitedOffer: z.boolean().optional().describe("Whether this is a time-limited offer."),
  startDate: z.string().optional().describe("ISO date string for offer start."),
  endDate: z.string().optional().describe("ISO date string for offer expiry."),
  code: z.string().optional().describe("Promo / coupon code."),
  link: z.string().optional().describe("Target destination link."),
  buttonText: z.string().optional().describe("Call to action button text."),
  authToken: z.string().optional().describe("Admin Materio ID token."),
};

const UpdatePromotionSchema = {
  id: z.string().describe("MongoDB ObjectId of the promotion to update."),
  title: z.string().optional().describe("Updated promotion title."),
  description: z.string().optional().describe("Updated description."),
  enabled: z.boolean().optional().describe("Toggle promotion on/off."),
  isLimitedOffer: z.boolean().optional().describe("Whether this is a time-limited offer."),
  startDate: z.string().optional().describe("ISO date string for offer start."),
  endDate: z.string().optional().describe("ISO date string for offer expiry."),
  code: z.string().optional().describe("Promo / coupon code."),
  link: z.string().optional().describe("Target destination link."),
  buttonText: z.string().optional().describe("Call to action button text."),
  authToken: z.string().optional().describe("Admin Materio ID token."),
};

const DeletePromotionSchema = {
  id: z.string().describe("MongoDB ObjectId of the promotion to delete."),
  authToken: z.string().optional().describe("Admin Materio ID token."),
};

const GetNotificationsSchema = {
  limit: z.number().int().positive().max(50).optional().default(10).describe("Maximum number of notifications to return."),
};

const CreateNotificationSchema = {
  title: z.string().describe("Notification title."),
  message: z.string().describe("Notification message content."),
  category: z.string().optional().default("General").describe("Category (e.g., 'Exams', 'Announcements', 'General')."),
  link: z.string().optional().describe("Optional URL link for the notification."),
  authToken: z.string().optional().describe("Admin Materio ID token."),
};

const UpdateNotificationSchema = {
  id: z.string().describe("Notification ID (_id or custom id)."),
  title: z.string().optional().describe("Updated notification title."),
  message: z.string().optional().describe("Updated notification message."),
  category: z.string().optional().describe("Updated category."),
  link: z.string().optional().describe("Updated link."),
  authToken: z.string().optional().describe("Admin Materio ID token."),
};

const DeleteNotificationSchema = {
  id: z.string().describe("Notification ID (_id or custom id) to delete."),
  authToken: z.string().optional().describe("Admin Materio ID token."),
};

// Notebook schemas
const GetAllNotebooksSchema = {
  authToken: z.string().optional().describe("Materio ID token if not provided in header."),
};

const CreateNotebookSchema = {
  title: z.string().describe("Title of the notebook or exported chat."),
  content: z.string().describe("The notebook notes / markdown content to save or export."),
  linkedPdf: z
    .object({
      url: z.string().optional(),
      name: z.string().optional(),
      subject: z.string().optional(),
      semester: z.string().optional(),
      category: z.string().optional(),
    })
    .optional()
    .describe("Optional reference to a linked course PDF document."),
  authToken: z.string().optional().describe("Materio ID token if not provided in header."),
};

const UpdateNotebookSchema = {
  id: z.string().describe("The notebook ID to update."),
  title: z.string().optional().describe("Updated title."),
  content: z.string().describe("Updated content."),
  authToken: z.string().optional().describe("Materio ID token if not provided in header."),
};

const DeleteNotebookSchema = {
  id: z.string().describe("The notebook ID to delete."),
  authToken: z.string().optional().describe("Materio ID token if not provided in header."),
};

// InsightRoom Posts schemas
const ListPostsSchema = {
  limit: z.number().int().positive().max(50).optional().describe("Number of posts to return."),
  subject: z.string().optional().describe("Filter by subject."),
  semester: z.string().optional().describe("Filter by semester."),
  authToken: z.string().optional().describe("Materio ID token (unlocks private posts if Plus or Admin)."),
};

const ReadPostsSchema = {
  slug: z.string().describe("The unique slug of the InsightRoom post to read."),
  category: z.string().optional().describe("Category slug if known (e.g. 'engineering')."),
  authToken: z.string().optional().describe("Materio ID token (unlocks private posts if Plus or Admin)."),
};

export function registerCommunityTools(
  server: McpServer,
  context?: { user?: MaterioProtectedUser | null; accessTier?: AccessTier; token?: string }
): void {
  // Helper to resolve effective user & tier
  async function resolveAuth(token?: string) {
    let effectiveTier: AccessTier = context?.accessTier ?? "guest";
    let effectiveUser = context?.user ?? null;
    let effectiveToken = token || context?.token;

    if (token) {
      const validated = await validateToken(token);
      if (validated.user) {
        effectiveUser = validated.user;
        effectiveTier = validated.accessTier;
      }
    }
    return { effectiveTier, effectiveUser, effectiveToken };
  }

  const isAdmin =
    context?.accessTier === "super" ||
    (context?.accessTier as string) === "admin";
  const isPlusOrAdmin =
    context?.accessTier === "plus" ||
    isAdmin;

  // ─────────────────────────────────────────────────────────────
  // 1. PUBLIC READ TOOLS (All Users)
  // ─────────────────────────────────────────────────────────────

  // check_current_exams
  server.registerTool(
    "check_current_exams",
    {
      title: "Check Current Exams & Schedules",
      description: "Read active semester exam schedules, dates, and seating configurations from Materio.",
      inputSchema: CheckCurrentExamsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const data = await fetchCurrentExams();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error fetching exams: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // active_promotions
  server.registerTool(
    "active_promotions",
    {
      title: "Get Active Promotions",
      description: "Read currently active promotions, seasonal discounts, and banners available on Materio.",
      inputSchema: ActivePromotionsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const data = await fetchActivePromotions();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error fetching promotions: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // notifications
  server.registerTool(
    "notifications",
    {
      title: "Get Official Notifications",
      description: "Read official announcements, exam alerts, and university notices from the Materio feed.",
      inputSchema: GetNotificationsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ limit }) => {
      try {
        const data = await fetchNotifications(limit);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error fetching notifications: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // ─────────────────────────────────────────────────────────────
  // 2. INSIGHTROOM POSTS (Public Read, Plus/Admin private unlock)
  // ─────────────────────────────────────────────────────────────

  // list_posts
  server.registerTool(
    "list_posts",
    {
      title: "List InsightRoom Posts",
      description: "List articles and posts published on InsightRoom (room.getmaterio.app). For Plus and Super users, also includes private exclusive posts.",
      inputSchema: ListPostsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ limit, subject, semester, authToken }) => {
      try {
        const { effectiveTier, effectiveToken } = await resolveAuth(authToken);
        const includePrivate = effectiveTier === "plus" || effectiveTier === "super";

        const posts = await fetchInsightroomPosts({
          limit,
          subject,
          semester,
          token: effectiveToken,
          includePrivate,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                total: posts.length,
                accessTier: effectiveTier,
                includesPrivatePosts: includePrivate,
                posts,
              }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error listing posts: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // read_posts
  server.registerTool(
    "read_posts",
    {
      title: "Read InsightRoom Post",
      description: "Read the full rendered article of an InsightRoom post by its slug. Plus and Super members have access to private posts.",
      inputSchema: ReadPostsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ slug, category, authToken }) => {
      try {
        const { effectiveTier, effectiveToken } = await resolveAuth(authToken);
        const canAccessPrivate = effectiveTier === "plus" || effectiveTier === "super";

        const result = await readInsightroomPost({
          slug,
          category,
          token: effectiveToken,
          canAccessPrivate,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error reading post: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // ─────────────────────────────────────────────────────────────
  // 3. PERSONAL CLOUD NOTEBOOKS (Pro & Admin Users Only)
  // ─────────────────────────────────────────────────────────────

  if (isPlusOrAdmin) {
    // get_all_notebooks
    server.registerTool(
      "get_all_notebooks",
      {
        title: "Get User's Personal Cloud Notebooks",
        description: "Retrieve all personal cloud notebooks belonging exclusively to the authenticated user. Exclusively for Materio Pro and Admin members.",
        inputSchema: GetAllNotebooksSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ authToken }) => {
        try {
          const { effectiveTier, effectiveToken, effectiveUser } = await resolveAuth(authToken);
          const access = checkToolAccess(effectiveTier, "plus");
          if (!access.allowed || !effectiveToken) {
            return {
              content: [{
                type: "text" as const,
                text: `Cloud Notebooks Access Restricted: ${access.message || "Authentication with Materio Pro or Admin required."}\nUpgrade or sign in at https://auth.getmaterio.app`,
              }],
            };
          }

        const data = await fetchUserNotebooks(effectiveToken, effectiveUser);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error retrieving notebooks: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

    // create_notebook
    server.registerTool(
      "create_notebook",
      {
        title: "Create Notebook or Export Chat to Notebooks",
        description: "Create a new personal cloud notebook or export chat notes/summaries directly into Materio Notebooks. Exclusively for Materio Pro and Admin members.",
        inputSchema: CreateNotebookSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async ({ title, content, linkedPdf, authToken }) => {
        try {
          const { effectiveTier, effectiveToken, effectiveUser } = await resolveAuth(authToken);
          const access = checkToolAccess(effectiveTier, "plus");
          if (!access.allowed || !effectiveToken) {
            return {
              content: [{
                type: "text" as const,
                text: `Cloud Notebooks Access Restricted: ${access.message || "Authentication with Materio Pro or Admin required."}\nUpgrade or sign in at https://auth.getmaterio.app`,
              }],
            };
          }

        const result = await syncUserNotebook(effectiveToken, {
          title,
          content,
          linkedPdf: linkedPdf || null,
        }, effectiveUser);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: `Notebook "${title}" saved to cloud successfully.`,
              notebook: result.notebook,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error creating notebook: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

    // update_notebook
    server.registerTool(
      "update_notebook",
      {
        title: "Update Personal Cloud Notebook",
        description: "Update the title or content of an existing personal cloud notebook owned by the user. Exclusively for Materio Pro and Admin members.",
        inputSchema: UpdateNotebookSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ id, title, content, authToken }) => {
        try {
          const { effectiveTier, effectiveToken, effectiveUser } = await resolveAuth(authToken);
          const access = checkToolAccess(effectiveTier, "plus");
          if (!access.allowed || !effectiveToken) {
            return {
              content: [{
                type: "text" as const,
                text: `Cloud Notebooks Access Restricted: ${access.message || "Authentication with Materio Pro or Admin required."}`,
              }],
            };
          }

          const result = await syncUserNotebook(effectiveToken, {
            id,
            title: title || "Untitled Note",
            content,
          }, effectiveUser);

          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error updating notebook: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    );

    // delete_notebook
    server.registerTool(
      "delete_notebook",
      {
        title: "Delete Personal Cloud Notebook",
        description: "Delete an existing personal cloud notebook owned by the user. Exclusively for Materio Pro and Admin members.",
        inputSchema: DeleteNotebookSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ id, authToken }) => {
        try {
          const { effectiveTier, effectiveToken, effectiveUser } = await resolveAuth(authToken);
          const access = checkToolAccess(effectiveTier, "plus");
          if (!access.allowed || !effectiveToken) {
            return {
              content: [{
                type: "text" as const,
                text: `Cloud Notebooks Access Restricted: ${access.message || "Authentication with Materio Pro or Admin required."}`,
              }],
            };
          }

          const result = await deleteUserNotebook(effectiveToken, id, effectiveUser);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error deleting notebook: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    );
  }

  // ─────────────────────────────────────────────────────────────
  // 4. ADMIN & SUPER USER TOOLS (Promotions, Notifications, Exams)
  // ─────────────────────────────────────────────────────────────

  if (isAdmin) {
    // edit_exam_data
    server.registerTool(
      "edit_exam_data",
      {
        title: "Edit Exam Configuration",
        description: "Update active exam dates, semesters, and seating arrangement settings. Requires Admin privileges (`accessTier === 'super'`).",
        inputSchema: EditExamDataSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ examData, authToken }) => {
        try {
          const { effectiveTier, effectiveToken, effectiveUser } = await resolveAuth(authToken);
          const access = checkToolAccess(effectiveTier, "admin");
          if (!access.allowed || !effectiveToken) {
            return {
              content: [{ type: "text" as const, text: `Admin privileges required: ${access.message}` }],
            };
          }

          const result = await updateExamData(effectiveToken, examData, effectiveUser);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error updating exam data: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    );

    // list_all_promotions
    server.registerTool(
      "list_all_promotions",
      {
        title: "List All Promotions",
        description: "List all promotions including disabled and expired campaigns. Requires Admin privileges.",
        inputSchema: ListAllPromotionsSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ authToken }) => {
        try {
          const { effectiveTier, effectiveToken, effectiveUser } = await resolveAuth(authToken);
          const access = checkToolAccess(effectiveTier, "admin");
          if (!access.allowed || !effectiveToken) {
            return {
              content: [{ type: "text" as const, text: `Admin privileges required: ${access.message}` }],
            };
          }

          const result = await fetchAllPromotions(effectiveToken, effectiveUser);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error listing promotions: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    );

    // create_promotion
    server.registerTool(
      "create_promotion",
      {
        title: "Create Promotion",
        description: "Create a new promotion banner on Materio. Requires Admin privileges.",
        inputSchema: CreatePromotionSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (args) => {
        try {
          const { authToken, ...promoData } = args;
          const { effectiveTier, effectiveToken, effectiveUser } = await resolveAuth(authToken);
          const access = checkToolAccess(effectiveTier, "admin");
          if (!access.allowed || !effectiveToken) {
            return {
              content: [{ type: "text" as const, text: `Admin privileges required: ${access.message}` }],
            };
          }

          const result = await createPromotion(effectiveToken, promoData, effectiveUser);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error creating promotion: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    );

    // update_promotion
    server.registerTool(
      "update_promotion",
      {
        title: "Update Promotion",
        description: "Update details or toggle status of an existing promotion. Requires Admin privileges.",
        inputSchema: UpdatePromotionSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args) => {
        try {
          const { authToken, ...promoData } = args;
          const { effectiveTier, effectiveToken, effectiveUser } = await resolveAuth(authToken);
          const access = checkToolAccess(effectiveTier, "admin");
          if (!access.allowed || !effectiveToken) {
            return {
              content: [{ type: "text" as const, text: `Admin privileges required: ${access.message}` }],
            };
          }

          const result = await updatePromotion(effectiveToken, promoData, effectiveUser);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error updating promotion: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    );

    // delete_promotion
    server.registerTool(
      "delete_promotion",
      {
        title: "Delete Promotion",
        description: "Delete a promotion from the Materio database. Requires Admin privileges.",
        inputSchema: DeletePromotionSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ id, authToken }) => {
        try {
          const { effectiveTier, effectiveToken, effectiveUser } = await resolveAuth(authToken);
          const access = checkToolAccess(effectiveTier, "admin");
          if (!access.allowed || !effectiveToken) {
            return {
              content: [{ type: "text" as const, text: `Admin privileges required: ${access.message}` }],
            };
          }

          const result = await deletePromotion(effectiveToken, id, effectiveUser);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error deleting promotion: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    );

    // create_notification
    server.registerTool(
      "create_notification",
      {
        title: "Create Notification",
        description: "Broadcast an official notification or academic alert. Requires Admin privileges.",
        inputSchema: CreateNotificationSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (args) => {
        try {
          const { authToken, ...notifData } = args;
          const { effectiveTier, effectiveToken, effectiveUser } = await resolveAuth(authToken);
          const access = checkToolAccess(effectiveTier, "admin");
          if (!access.allowed || !effectiveToken) {
            return {
              content: [{ type: "text" as const, text: `Admin privileges required: ${access.message}` }],
            };
          }

          const result = await createNotification(effectiveToken, notifData, effectiveUser);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error creating notification: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    );

    // update_notification
    server.registerTool(
      "update_notification",
      {
        title: "Update Notification",
        description: "Update an existing notification. Requires Admin privileges.",
        inputSchema: UpdateNotificationSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args) => {
        try {
          const { authToken, ...notifData } = args;
          const { effectiveTier, effectiveToken, effectiveUser } = await resolveAuth(authToken);
          const access = checkToolAccess(effectiveTier, "admin");
          if (!access.allowed || !effectiveToken) {
            return {
              content: [{ type: "text" as const, text: `Admin privileges required: ${access.message}` }],
            };
          }

          const result = await updateNotification(effectiveToken, notifData, effectiveUser);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error updating notification: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    );

    // delete_notification
    server.registerTool(
      "delete_notification",
      {
        title: "Delete Notification",
        description: "Delete an announcement or notification. Requires Admin privileges.",
        inputSchema: DeleteNotificationSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ id, authToken }) => {
        try {
          const { effectiveTier, effectiveToken, effectiveUser } = await resolveAuth(authToken);
          const access = checkToolAccess(effectiveTier, "admin");
          if (!access.allowed || !effectiveToken) {
            return {
              content: [{ type: "text" as const, text: `Admin privileges required: ${access.message}` }],
            };
          }

          const result = await deleteNotification(effectiveToken, id, effectiveUser);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error deleting notification: ${err instanceof Error ? err.message : String(err)}` }],
          };
        }
      }
    );
  }
}
