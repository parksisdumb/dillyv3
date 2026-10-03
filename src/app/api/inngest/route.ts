import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

// Agent runs (LLM calls) can take a while; give the serverless function room.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
