// AI service layer
import { prisma } from "../../shared/prisma.js";
import { filterQuestion, answerQuestion } from "./client.js";

export type AiMessageStatus = "ANSWERED" | "REFUSED" | "FAILED";

export interface AskResult {
  id: string;
  answer: string | null;
  status: AiMessageStatus;
  createdAt: Date;
}

export interface HistoryFilters {
  userId?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

export interface PaginatedHistory {
  data: Array<{
    id: string;
    question: string;
    answer: string | null;
    status: AiMessageStatus;
    model: string;
    createdAt: Date;
  }>;
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Process an AI question: filter -> (if IT) answer -> save.
 * Always saves to database regardless of outcome.
 */
export async function askQuestion(
  userId: string,
  question: string
): Promise<AskResult> {
  const trimmedQuestion = question.trim();

  // Check if AI is configured
  if (!process.env.DEEPSEEK_API_KEY) {
    const saved = await prisma.aiMessage.create({
      data: {
        userId,
        question: trimmedQuestion,
        answer: null,
        status: "FAILED",
        model: process.env.AI_MODEL ?? "deepseek-chat",
      },
    });
    return {
      id: saved.id,
      answer: null,
      status: "FAILED",
      createdAt: saved.createdAt,
    };
  }

  let filterResult: "IT" | "NOT_IT" | null = null;
  let filterError: Error | null = null;

  // Step 1: Filter
  try {
    filterResult = await filterQuestion(trimmedQuestion);
  } catch (err) {
    filterError = err instanceof Error ? err : new Error("Filter failed");
    console.error("[AI Filter] Error:", filterError.message);
  }

  // Fail closed: only "IT" proceeds to answer. Any other result (NOT_IT, unexpected, empty) -> REFUSED
  if (filterError || filterResult !== "IT") {
    const saved = await prisma.aiMessage.create({
      data: {
        userId,
        question: trimmedQuestion,
        answer: null,
        status: "REFUSED",
        model: process.env.AI_MODEL ?? "deepseek-chat",
      },
    });
    return {
      id: saved.id,
      answer: null,
      status: "REFUSED",
      createdAt: saved.createdAt,
    };
  }

  // Step 2: Answer (only if filter returned exactly "IT")
  try {
    const answer = await answerQuestion(trimmedQuestion);
    const saved = await prisma.aiMessage.create({
      data: {
        userId,
        question: trimmedQuestion,
        answer,
        status: "ANSWERED",
        model: process.env.AI_MODEL ?? "deepseek-chat",
      },
    });
    return {
      id: saved.id,
      answer,
      status: "ANSWERED",
      createdAt: saved.createdAt,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error("Answer failed");
    console.error("[AI Answer] Error:", error.message);

    const saved = await prisma.aiMessage.create({
      data: {
        userId,
        question: trimmedQuestion,
        answer: null,
        status: "FAILED",
        model: process.env.AI_MODEL ?? "deepseek-chat",
      },
    });
    return {
      id: saved.id,
      answer: null,
      status: "FAILED",
      createdAt: saved.createdAt,
    };
  }
}

/**
 * Get paginated history for a user.
 * USER sees only their own; SUPER_ADMIN can see all (with optional userId filter).
 */
export async function getHistory(
  requesterId: string,
  requesterRole: string,
  filters: HistoryFilters
): Promise<PaginatedHistory> {
  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 20, 100);
  // Note: schema validation allows up to 100, but we also cap here for safety

  const where: Record<string, unknown> = {};

  if (requesterRole === "SUPER_ADMIN" && filters.userId) {
    where.userId = filters.userId;
  } else if (requesterRole !== "SUPER_ADMIN") {
    // Non-SUPER_ADMIN users only see their own messages
    where.userId = requesterId;
  }
  // SUPER_ADMIN without userId filter sees all (no userId in where)

  const [data, total] = await Promise.all([
    prisma.aiMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        question: true,
        answer: true,
        status: true,
        model: true,
        createdAt: true,
      },
    }),
    prisma.aiMessage.count({ where }),
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}