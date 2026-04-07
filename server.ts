import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import path from "path";

const mcpServer = new Server({
  name: "flash-ui-mcp",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
  }
});

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "generate_ui",
        description: "Generates a high-fidelity UI component using Gemini 3 Flash",
        inputSchema: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Description of the UI component to generate" },
            componentType: { type: "string", description: "Type of component (e.g., Button, Card, Form)" }
          },
          required: ["prompt"]
        }
      }
    ]
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "generate_ui") {
    const prompt = request.params.arguments?.prompt as string;
    const componentType = (request.params.arguments?.componentType as string) || "UI Component";
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }

    const ai = new GoogleGenAI({ apiKey });
    
    // 1. Generate style
    const stylePrompt = `Generate 1 distinct, highly evocative design direction for a ${componentType} described as: "${prompt}". Return ONLY a raw string name.`;
    const styleResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { role: 'user', parts: [{ text: stylePrompt }] }
    });
    const styleInstruction = styleResponse.text?.trim() || "Modern Minimalist";

    // 2. Generate HTML
    const genPrompt = `
You are Flash UI. Create a stunning, high-fidelity ${componentType} for: "${prompt}".
**CONCEPTUAL DIRECTION: ${styleInstruction}**
**VISUAL EXECUTION RULES:**
1. **Materiality**: Use the specified metaphor to drive every CSS choice.
2. **Typography**: Use high-quality web fonts.
3. **Motion & Reactivity**: The ${componentType} MUST be highly reactive and dynamic.
4. **IP SAFEGUARD**: No artist names or trademarks. 
5. **Layout**: Be bold with negative space and hierarchy. Avoid generic designs.
Return ONLY RAW HTML. No markdown fences.
    `.trim();

    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { role: 'user', parts: [{ text: genPrompt }] }
    });

    let finalHtml = response.text?.trim() || "";
    if (finalHtml.startsWith('```html')) finalHtml = finalHtml.substring(7).trimStart();
    if (finalHtml.startsWith('```')) finalHtml = finalHtml.substring(3).trimStart();
    if (finalHtml.endsWith('```')) finalHtml = finalHtml.substring(0, finalHtml.length - 3).trimEnd();

    return {
      content: [
        {
          type: "text",
          text: finalHtml
        }
      ]
    };
  }
  throw new Error("Tool not found");
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());

  let transport: SSEServerTransport | null = null;

  app.get("/mcp/sse", async (req, res) => {
    transport = new SSEServerTransport("/mcp/messages", res);
    await mcpServer.connect(transport);
  });

  app.post("/mcp/messages", express.json(), async (req, res) => {
    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      res.status(400).send("SSE connection not established");
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`MCP SSE Endpoint: http://localhost:${PORT}/mcp/sse`);
  });
}

startServer();
