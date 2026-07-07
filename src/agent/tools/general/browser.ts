/**
 * Browser Tool - Playwright Implementation
 * 
 * Capabilities:
 *      - open webpage
 *      - read webpage
 *          - text
 *          - html
 *          - make snapshot and read snapshot
 */

import { Browser, BrowserContext, Page, chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as z from 'zod';
import { Tool, tool } from '../tools';
import { ReActAgentPluginSpec } from '../../ReAct.agent';
import { recordEventWithData } from '../../../telemetry';

/**
 * Configuration for browser operations
 */
interface BrowserConfig {
  headless?: boolean;
  timeout?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  snapshotDir?: string;
}

/**
 * Result of reading webpage content
 */
interface PageContent {
  text: string;
  html: string;
  url: string;
  title: string;
}

/**
 * Browser tool class for managing webpage interactions
 */
export class BrowserTool {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: Required<BrowserConfig>;

  constructor(config: BrowserConfig = {}) {
    this.config = {
      headless: config.headless ?? true,
      timeout: config.timeout ?? 30000,
      viewportWidth: config.viewportWidth ?? 1920,
      viewportHeight: config.viewportHeight ?? 1080,
      snapshotDir: config.snapshotDir ?? './snapshots',
    };

    recordEventWithData("browser_tool.initialized", {
      reason: "Browser setup is initialized",
      setup: this.config
    });

    // Ensure snapshot directory exists
    if (!fs.existsSync(this.config.snapshotDir)) {
      fs.mkdirSync(this.config.snapshotDir, { recursive: true });
    }
  }

  /**
   * Launch browser and open a new page
   */
  async openWebpage(url: string): Promise<void> {
    try {
      if (!this.browser) {
        this.browser = await chromium.launch({ headless: this.config.headless });
      }

      if (!this.context) {
        this.context = await this.browser.newContext({
          viewport: {
            width: this.config.viewportWidth,
            height: this.config.viewportHeight,
          },
        });
      }

      this.page = await this.context.newPage();
      this.page.setDefaultTimeout(this.config.timeout);

      await this.page.goto(url, { waitUntil: 'networkidle' });
    } catch (error) {
      throw new Error(`Failed to open webpage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Read text content from the current page
   */
  async readText(): Promise<string> {
    if (!this.page) {
      throw new Error('No page is currently open. Call openWebpage() first.');
    }

    try {
      return await this.page.evaluate(() => document.documentElement.innerText);
    } catch (error) {
      throw new Error(`Failed to read text: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Read HTML content from the current page
   */
  async readHtml(): Promise<string> {
    if (!this.page) {
      throw new Error('No page is currently open. Call openWebpage() first.');
    }

    try {
      return await this.page.evaluate(() => document.documentElement.outerHTML);
    } catch (error) {
      throw new Error(`Failed to read HTML: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Read all content (text, html, url, title) from the current page
   */
  async readPageContent(): Promise<PageContent> {
    if (!this.page) {
      throw new Error('No page is currently open. Call openWebpage() first.');
    }

    try {
      const [text, html] = await Promise.all([
        this.readText(),
        this.readHtml(),
      ]);

      return {
        text,
        html,
        url: this.page.url(),
        title: await this.page.title(),
      };
    } catch (error) {
      throw new Error(`Failed to read page content: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Take a screenshot/snapshot of the current page as a Buffer (no disk write)
   */
  async takeSnapshotBuffer(): Promise<Buffer> {
    if (!this.page) {
      throw new Error('No page is currently open. Call openWebpage() first.');
    }

    try {
      return await this.page.screenshot({ fullPage: true });
    } catch (error) {
      throw new Error(`Failed to take snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Take a screenshot/snapshot of the current page
   */
  async takeSnapshot(filename?: string): Promise<string> {
    if (!this.page) {
      throw new Error('No page is currently open. Call openWebpage() first.');
    }

    try {
      const snapshotName =
        filename || `snapshot-${Date.now()}.png`;
      const snapshotPath = path.join(this.config.snapshotDir, snapshotName);

      await this.page.screenshot({ path: snapshotPath, fullPage: true });

      return snapshotPath;
    } catch (error) {
      throw new Error(`Failed to take snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Read a snapshot file
   */
  async readSnapshot(snapshotPath: string): Promise<Buffer> {
    try {
      if (!fs.existsSync(snapshotPath)) {
        throw new Error(`Snapshot file not found: ${snapshotPath}`);
      }

      return fs.readFileSync(snapshotPath);
    } catch (error) {
      throw new Error(`Failed to read snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get snapshot as base64 string
   */
  async getSnapshotBase64(snapshotPath: string): Promise<string> {
    try {
      const buffer = await this.readSnapshot(snapshotPath);
      return buffer.toString('base64');
    } catch (error) {
      throw new Error(`Failed to convert snapshot to base64: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Close current page
   */
  async closePage(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
  }

  /**
   * Close browser and cleanup
   */
  async close(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }

    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Check if browser is currently running
   */
  isOpen(): boolean {
    return this.browser !== null && this.page !== null;
  }
}

/**
 * Utility function to create a browser tool instance
 */
export async function createBrowserTool(config?: BrowserConfig): Promise<BrowserTool> {
  return new BrowserTool(config);
}

/**
 * Zod schemas for browser tool arguments and outputs
 */
const OpenWebpageArgsSchema = z.object({
  url: z.string().describe('URL of the webpage to open'),
});

const PageContentSchema = z.object({
  text: z.string().describe('Text content of the page'),
  html: z.string().describe('HTML content of the page'),
  url: z.string().describe('Current page URL'),
  title: z.string().describe('Page title'),
});

const SnapshotArgsSchema = z.object({
  filename: z.string().optional().describe('Optional filename for the snapshot'),
});

const SnapshotBase64ArgsSchema = z.object({
  snapshotPath: z.string().describe('Path to the snapshot file'),
});

/**
 * Global browser instance for tool operations
 */
let globalBrowserTool: BrowserTool | null = null;

/**
 * Get or create global browser instance
 */
async function getGlobalBrowserTool(): Promise<BrowserTool> {
  if (!globalBrowserTool) {
    globalBrowserTool = new BrowserTool();
  }
  return globalBrowserTool;
}

/**
 * Browser tool: Open webpage
 */
export const openWebpageTool = tool(
  async (args) => {
    recordEventWithData("browser_tool.open_webpage.start", { url: args.url });
    const browserTool = await getGlobalBrowserTool();
    await browserTool.openWebpage(args.url);
    const result = JSON.stringify({ success: true, message: `Successfully opened ${args.url}` });
    recordEventWithData("browser_tool.open_webpage.end", { url: args.url, success: true });
    return result;
  },
  {
    toolName: 'open_webpage',
    toolDescription: 'Open a webpage in the browser and navigate to the specified URL',
    toolArguments: OpenWebpageArgsSchema,
    toolOutputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
    }),
  }
);

/**
 * Browser tool: Read page text
 */
export const readPageTextTool = tool(
  async () => {
    recordEventWithData("browser_tool.read_page_text.start", {});
    const browserTool = await getGlobalBrowserTool();
    const text = await browserTool.readText();
    recordEventWithData("browser_tool.read_page_text.end", { contentLength: text.length });
    return text;
  },
  {
    toolName: 'read_page_text',
    toolDescription: 'Read the text content from the currently open webpage',
    toolArguments: z.object({}),
  }
);

/**
 * Browser tool: Read page HTML
 */
export const readPageHtmlTool = tool(
  async () => {
    recordEventWithData("browser_tool.read_page_html.start", {});
    const browserTool = await getGlobalBrowserTool();
    const html = await browserTool.readHtml();
    recordEventWithData("browser_tool.read_page_html.end", {});
    return html;
  },
  {
    toolName: 'read_page_html',
    toolDescription: 'Read the HTML content from the currently open webpage',
    toolArguments: z.object({}),
  }
);

/**
 * Browser tool: Read complete page content
 */
export const readPageContentTool = tool(
  async () => {
    recordEventWithData("browser_tool.read_page_content.start", {});
    const browserTool = await getGlobalBrowserTool();
    const content = await browserTool.readPageContent();
    recordEventWithData("browser_tool.read_page_content.end", {});
    return JSON.stringify(content);
  },
  {
    toolName: 'read_page_content',
    toolDescription: 'Read all content (text, html, url, title) from the currently open webpage',
    toolArguments: z.object({}),
    toolOutputSchema: PageContentSchema,
  }
);

/**
 * Browser tool: Take snapshot
 */
export const takeSnapshotTool = tool(
  async (args) => {
    recordEventWithData("browser_tool.snapshot.start", {});
    const browserTool = await getGlobalBrowserTool();
    const buffer = await browserTool.takeSnapshotBuffer();
    recordEventWithData("browser_tool.snapshot.ebd", {});
    return `data:image/png;base64,${buffer.toString("base64")}`;
  },
  {
    toolName: 'take_snapshot',
    toolDescription: 'Take a screenshot/snapshot of the currently open webpage without saving to disk and return it as a base64-encoded image data URL',
    toolArguments: SnapshotArgsSchema,
  }
);

/**
 * Browser tool: Get snapshot as base64
 */
export const getSnapshotBase64Tool = tool(
  async (args) => {
    recordEventWithData("browser_tool.snapshot_base64.start", {});
    const browserTool = await getGlobalBrowserTool();
    const base64 = await browserTool.getSnapshotBase64(args.snapshotPath);
    recordEventWithData("browser_tool.snapshot_base64.end", {});
    return base64;
  },
  {
    toolName: 'get_snapshot_base64',
    toolDescription: 'Convert a snapshot file to base64 string format',
    toolArguments: SnapshotBase64ArgsSchema,
  }
);

/**
 * Browser tool: Close current page
 */
export const closePageTool = tool(
  async () => {
    recordEventWithData("browser_tool.closepage_tool", {});
    const browserTool = await getGlobalBrowserTool();
    await browserTool.closePage();
    return JSON.stringify({ success: true, message: 'Page closed successfully' });
  },
  {
    toolName: 'close_page',
    toolDescription: 'Close the current browser page',
    toolArguments: z.object({}),
    toolOutputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
    }),
  }
);

/**
 * Browser tool: Close browser
 */
export const closeBrowserTool = tool(
  async () => {
    recordEventWithData("browser_tool.closepage_browser_tool", {});
    const browserTool = await getGlobalBrowserTool();
    await browserTool.close();
    globalBrowserTool = null;
    return JSON.stringify({ success: true, message: 'Browser closed successfully' });
  },
  {
    toolName: 'close_browser',
    toolDescription: 'Close the browser and cleanup all resources',
    toolArguments: z.object({}),
    toolOutputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
    }),
  }
);

/**
 * Browser tool: Check if browser is open
 */
export const isBrowserOpenTool = tool(
  async () => {
    recordEventWithData("browser_tool.is_browser_open_tool", {});
    const browserTool = await getGlobalBrowserTool();
    const isOpen = browserTool.isOpen();
    return JSON.stringify({ isOpen });
  },
  {
    toolName: 'is_browser_open',
    toolDescription: 'Check if the browser is currently running',
    toolArguments: z.object({}),
    toolOutputSchema: z.object({
      isOpen: z.boolean(),
    }),
  }
);

export interface BucketOfTools {
    bucketName: string;
    systemPrompt: string;
    tools: Tool<any, any>[];
}

/** Helpfull bucket with all tools users need to use for unharnessed webpages read */
export const BrowserToolsBucket: BucketOfTools = {
    bucketName: "browse-bucket",
    /**  System prompt instructs how to use tool */
    systemPrompt: `
You have access to a suite of browser automation tools for reading and interacting with webpages.

## Browser Tool Usage Guidelines:

### Workflow:
1. **Open Webpage**: Use \`open_webpage\` to navigate to a URL
2. **Read Content**: Choose the appropriate read tool:
   - \`read_page_text\` - for text content only
   - \`read_page_html\` - for HTML structure
   - \`read_page_content\` - for complete page data (text, html, url, title)
3. **Capture Screenshots**: Use \`take_snapshot\` to capture visual state
4. **Process Images**: Use \`get_snapshot_base64\` to convert snapshots to base64 for analysis
5. **Close Browser**: Use \`close_browser\` when you are completely done

### Important Rules:
- **State Tracking**: Browser state persists across tool calls. The same page remains open unless explicitly closed.
- **Automatic Cleanup**: When you have finished your task and extracted all needed information, ALWAYS call \`close_browser\` to free resources.
- **Error Handling**: If a tool fails, explain the limitation and continue with available information.
- **No Fabrication**: Use actual tool outputs, never invent webpage content.
- **Efficiency**: Read content once and extract all needed information, then close the browser.

### Tool Decision Matrix:
- Need just text? → \`read_page_text\`
- Need HTML for parsing? → \`read_page_html\`
- Need complete information? → \`read_page_content\`
- Need visual confirmation? → \`take_snapshot\`
- Need image data? → \`get_snapshot_base64\`

### Closure Detection:
After completing your analysis, check if the browser is still open using \`is_browser_open\`. 
If open and you're done, call \`close_browser\` to clean up.

### Example Flow:
1. open_webpage({ url: "https://example.com" })
2. read_page_content() → get full page data
3. Process and analyze the data
4. close_browser() → cleanup
    `,
    tools: [
        openWebpageTool,
        readPageTextTool,
        readPageHtmlTool,
        readPageContentTool,
        takeSnapshotTool,
        getSnapshotBase64Tool,
        closePageTool,
        closeBrowserTool,
        isBrowserOpenTool
    ]
}

export const ReActPluginBrowserAutoClose: ReActAgentPluginSpec = {
    name: "Browser-AutoClose",
    executionWay: "after_agent_run",
    async execute(agentConfig, graphState) {
        // Only close if it was actually opened
        if (globalBrowserTool) {
          recordEventWithData("agent_plugin.browser_auto_close", {
            reason: "browser was open"
          });
          await globalBrowserTool.close();
          globalBrowserTool = null;
        }
        
        return {
          status: false
        }
    },
}
