import { openai } from "@ai-sdk/openai";
import {
  type ModelMessage,
  tool,
  Experimental_Agent as Agent,
  stepCountIs,
} from "ai";
import { traceTool, traceAgent } from "@arizeai/openinference-core";
import { intro, log, outro, stream, text } from "@clack/prompts";
import invariant from "tiny-invariant";
import z from "zod";

const state: {
  messages: ModelMessage[];
  document: string;
  documentHistory: string[];
} = {
  messages: [],
  document: "",
  documentHistory: [],
};

const getDocument = async ({
  startIndex = 0,
  endIndex = state.document.length,
}: {
  startIndex?: number;
  endIndex?: number;
}) => {
  return state.document.slice(startIndex, endIndex);
};

const getDocumentTool = tool({
  description:
    "Get a slice of the document. If arguments are not provided, return the entire document.",
  inputSchema: z.object({
    startIndex: z
      .number()
      .optional()
      .describe("The start index of the slice. Defaults to 0."),
    endIndex: z
      .number()
      .optional()
      .describe(
        "The end index of the slice. Defaults to the length of the document."
      ),
  }),
  execute: async (input) => {
    return traceTool(getDocument)(input);
  },
});

const editDocument = async ({
  startIndex = 0,
  endIndex = state.document.length,
  content,
}: {
  startIndex?: number;
  endIndex?: number;
  content: string;
}) => {
  state.documentHistory.push(state.document);
  state.document =
    state.document.slice(0, startIndex) +
    content +
    state.document.slice(endIndex);
  return state.document;
};

const editDocumentTool = tool({
  description:
    "Edit the document. If arguments are not provided, the entire document will be edited.",
  inputSchema: z.object({
    startIndex: z
      .number()
      .optional()
      .describe("The start index of the edit. Defaults to 0."),
    endIndex: z
      .number()
      .optional()
      .describe(
        "The end index of the edit. Defaults to the length of the document."
      ),
    content: z.string().describe("The content to edit the document with."),
  }),
  execute: async (input) => {
    return traceTool(editDocument)(input);
  },
});

const undoEditDocument = async () => {
  state.document = state.documentHistory.pop() ?? "";
  return state.document;
};

const undoEditDocumentTool = tool({
  description: "Undo the last edit to the document.",
  inputSchema: z.object({}),
  execute: async () => {
    return traceTool(undoEditDocument)();
  },
});

const DocumentAgent = new Agent({
  model: openai.chat("gpt-4o"),
  tools: {
    getDocument: getDocumentTool,
    editDocument: editDocumentTool,
    undoEditDocument: undoEditDocumentTool,
  },
  experimental_telemetry: {
    isEnabled: true,
  },
  stopWhen: stepCountIs(10),
  system: `You are a document agent helping a user write a document. You are given a document and you are able to manage it as you see fit.`,
});

async function main() {
  intro("~~ Document Agent ~~");
  log.info(
    `Welcome to the Document Agent! It can help you write a document by editing it as you see fit.`
  );
  log.message(
    `Naturally ask the agent to start writing about anything you want.`
  );
  log.message(
    `Ask the agent at any time to view the document, edit it, or undo any number of edits.`
  );
  log.warn(`When you are done, press Ctrl+C to exit.`);
  log.info(
    `Every interaction with the agent will be traced and sent to Phoenix in one giant agent trace when done.`
  );
  log.message(
    `Run "pnpm d:up" to start a temporary in-memory Phoenix tracing server.`
  );
  log.message(`Run "pnpm d:down" to delete the phoenix server.`);
  log.message(
    `View traces at http://localhost:6006/ in the project "document-agent".`
  );
  log.success(`Happily write away!`);
  while (true) {
    async function documentAgent() {
      const messageContent = await text({
        message: "What should we do next?",
      });
      invariant(
        typeof messageContent === "string",
        "Message content must be a string"
      );
      state.messages.push({
        role: "user",
        content: messageContent,
      });

      const result = DocumentAgent.stream({ messages: state.messages });

      // Stream the response (only necessary for providing updates to the user)
      const responsesGenerator = async function* () {
        for await (const chunk of result.fullStream) {
          if (chunk.type === "text-delta") {
            yield chunk.text;
          }

          if (chunk.type === "tool-call") {
            yield "\n";
            const toolName = chunk.toolName;
            switch (toolName) {
              case "getDocument":
                yield "Getting document...";
                break;
              case "editDocument":
                yield "Editing document...";
                break;
              case "undoEditDocument":
                yield "Undoing document edit...";
                break;
              default:
                yield `Thinking...`;
                break;
            }
            yield "\n";
          }

          yield "";
        }
      };

      await stream.message(responsesGenerator());

      // Add LLM generated messages to the message history
      const responseMessages = (await result.response).messages;
      state.messages.push(...responseMessages);
    }

    await documentAgent();
  }
}

traceAgent(
  () =>
    main().catch(() => {
      outro("Closing Document Agent. Bye!");
    }),
  {
    name: "documentAgent",
  }
)();
