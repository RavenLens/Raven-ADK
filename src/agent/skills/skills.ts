// TODO: Develop Skills Shape and stores like localPersistant, localTemporary, Redis, MongoDB
// TODO: Develop cascade skills
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import z from "zod";
import { tool, Tool } from "../tools/tools";
import { SchemaSkillStore, SkillFileEntryWithContent } from "./stores/schema";

type SkillScriptRuntime = "auto" | "node" | "python" | "powershell" | "bash" | "cmd";

interface CommandExecutionResult {
    success: boolean;
    command: string;
    args: string[];
    cwd: string;
    exitCode: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    truncatedStdout: boolean;
    truncatedStderr: boolean;
    error?: string;
}

// TODO: Add the dynamic skill updation and add prompt
export interface SkillSharedConfig {
    /**
     * Derives default value from the of base [`Skills`](../skills.ts) class
     * Manual configuration will be overrided by builtin logic
    */
    dynamicSkillCreation?: boolean;
    /**
     * Allow to dynamically remove the skill(s)
     * Default: `false`
     */
    dynamicSkillRemoval?: boolean;
    /**
     * Skill relocation
     * Default: `false`
    */
    dynamicSkillRelocation?: boolean;
    /** 
     * Optional: Session is required to store the skills bound e.g: to user account or specific user session
     * Some stores requires it some other don't
    */
    session?: string;
}

export interface SkillConfig<SkillStorage extends SchemaSkillStore> extends SkillSharedConfig {
    skillStorage: SkillStorage;
}

type SkillEventHandler<T extends Array<any>> = (...args: T) => any;

export interface SkillEvents {
    readSkillFull: SkillEventHandler<Parameters<SchemaSkillStore["readSkillFull"]>>,
    readSkillMeta: SkillEventHandler<Parameters<SchemaSkillStore["readSkillMeta"]>>,
    discoverSkillFolder: SkillEventHandler<Parameters<SchemaSkillStore["discoverSkillFolder"]>>,
    createSkillFile: SkillEventHandler<Parameters<SchemaSkillStore["createSkillFile"]>>,
    createSkillFolder: SkillEventHandler<Parameters<SchemaSkillStore["createSkillFolder"]>>,
    reloacateSkill: SkillEventHandler<Parameters<SchemaSkillStore["reloacateSkill"]>>,
    removeSkill: SkillEventHandler<Parameters<SchemaSkillStore["removeSkill"]>>,
    removeSkillFolder: SkillEventHandler<Parameters<SchemaSkillStore["removeSkillFolder"]>>,
    // TODO: Add script execution events
}

export type SkillEventNames = keyof SkillEvents;

interface SkillsFoundation<SkillStorage extends SchemaSkillStore> {
    config: SkillConfig<SkillStorage>;
    createExploreSkillsAgentTools(): Tool<any, any>[];
    createSkillScriptExecuteTools(): Tool<any, any>[];
    createExploreSkillsAgentTools(): Tool<any, any>[];
    api: SkillConfig<SkillStorage>["skillStorage"]
}

export class Skills<SkillStorage extends SchemaSkillStore> implements SkillsFoundation<SkillStorage> {
    config: SkillConfig<SkillStorage>;
    private EventsListeners: Record<string, SkillEventHandler<any>> = {};

    static exploreSkillsPrompt: string = [
        "### Skills Exploration",
        "Discover, inspect, and reuse skills in a format compatible with the Open Skills standard: https://agentskills.io/home.",
        "Use only the provided skill tools and follow their argument schemas exactly.",
        "",
        "Why to use skills in a ReAct workflow:",
        "- Skills reduce repeated reasoning, increase consistency, and keep execution grounded in verified instructions.",
        "- Skills should be checked before inventing a new approach for a task that may already be solved.",
        "",
        "When to explore skills:",
        "- Before solving a non-trivial task, especially if it looks repeatable or procedural.",
        "- Before creating a new skill candidate, to avoid duplicates or near-duplicates.",
        "- After tool outputs reveal uncertainty about the correct process.",
        "",
        "How to find available skills:",
        "- A hierarchical tree of available skills is provided at the bottom of the system prompt.",
        "- Use this tree to identify potential matches by name and brief description.",
        "- If a description is truncated (ends with \"...\"), use exploration tools to get more details.",
        "",
        "Available explore tools (from createExploreSkillsAgentTools):",
        "1) skill_folder_discover",
        "   - Arguments: { fromLocation?: string }",
        "   - Purpose: list direct child entries from a location. Returns JSON text of entries with folder/file types and relative locations.",
        "2) skill_meta_read",
        "   - Arguments: { fromLocation?: string }",
        "   - Purpose: read only SKILL.md frontmatter metadata for a skill folder/file path.",
        "3) skill_full_read",
        "   - Arguments: { fromLocation?: string }",
        "   - Purpose: read full SKILL.md content for complete skill understanding.",
        "",
        "How to explore and reuse (ReAct-compatible loop):",
        "- Reason: identify what capability is needed and check the provided skills tree.",
        "- Act: if needed, call skill_folder_discover to map candidate wards and skills in more detail.",
        "- Act: call skill_meta_read on likely matches for quick filtering or to see information missing from the tree.",
        "- Act: call skill_full_read only for finalists before applying instructions or using its scripts and assets.",
        "- Observe: compare discovered capability to current objective and continue only with evidence.",
        "- If no suitable skill is confirmed, continue task execution and only then consider creation policy.",
        "",
        "Open Skills alignment rules:",
        "- The canonical skill definition is SKILL.md.",
        "- Preferred structure is <skill>/SKILL.md with optional scripts, references, assets, and documentation.",
        "- Keep interpretations grounded in file content; do not invent metadata or capabilities.",
        "",
        "Output policy:",
        "- Summarize discovered skill hierarchy and candidate matches.",
        "- Explicitly mention uncertainty when metadata/full content is unavailable.",
        "- Never claim a skill exists without evidence from discover/read tools."
    ].join("\n");
    static executeSkillScriptsPrompt: string = [
        "### Skills Execution",
        "Execute verified skill scripts through command-line tools and report outputs as evidence.",
        "Use only the provided script execution tools and follow argument schemas exactly.",
        "",
        "Why execution tools exist in ReAct:",
        "- Some skills include executable scripts that produce evidence, artifacts, or deterministic outputs.",
        "- Script execution should be used when reading instructions is not enough and real execution is required.",
        "",
        "When to execute:",
        "- After discovering a candidate skill and confirming script intent from SKILL.md or related files.",
        "- When the task requires concrete runtime output, not just planning.",
        "- Prefer execution only after inputs and working directory are clear.",
        "",
        "Available execution tools:",
        "1) skill_script_run",
        "   - Arguments: { scriptLocation: string, runtime?: auto|node|python|powershell|bash|cmd, scriptArgs?: string[], workingDirectory?: string, timeoutMs?: number }",
        "   - Purpose: run a script file by path, with runtime autodetection or explicit runtime override.",
        "2) skill_cli_execute",
        "   - Arguments: { command: string, args?: string[], workingDirectory?: string, timeoutMs?: number }",
        "   - Purpose: run a direct command-line command when script wrappers or custom commands are needed.",
        "",
        "Safe execution workflow:",
        "- Discover/read skill first, then execute; do not run unrelated commands.",
        "- Start with minimal arguments and bounded timeout.",
        "- Treat non-zero exit codes and stderr as observations to reason over, not silent failures.",
        "- Do not fabricate execution success when command fails.",
        "",
        "Output policy:",
        "- Report command, arguments, cwd, exit code, stdout/stderr excerpts, and timeout state.",
        "- Use tool output as evidence for the final answer or next action."
    ].join("\n");
    
    constructor(config: SkillConfig<SkillStorage>) {
        this.config = config;
    }

    onEvent<EventName extends keyof SkillEvents>(
        eventName: EventName,
        eventListener: SkillEvents[EventName]
    ): this {
        if (this.EventsListeners[eventName]) {
            console.warn(`Event listener for skill event "${eventName}" is already registered.`);
            return this;
        }

        this.EventsListeners[eventName] = eventListener;
        return this;
    }

    protected emit<EventName extends keyof SkillEvents>(
        eventName: EventName,
        ...eventArgs: Parameters<SkillEvents[EventName]>
    ) {
        const eventListener = this.EventsListeners[eventName];

        if (!eventListener) {
            return;
        }

        const listener = eventListener as unknown as SkillEvents[EventName];

        void Promise.resolve((listener as any)(...eventArgs)).catch((error) => {
            console.warn(`Skill event listener for "${String(eventName)}" failed during execution.`, error);
        });
    }

    createSkillsManagementPrompt() {
        const promptLines = [
            "### Skills Creation & Management.",
            "You have capabilities to manage the skills in RavenADK while keeping Open Skills compatibility: https://agentskills.io/home.",
            "Use only the provided management/exploration tools and respect each tool schema exactly.",
            "",
            "Why skill management exists in ReAct:",
            "- Capture newly developed, reusable know-how discovered while solving real tasks.",
            "- Improve future task quality by turning proven procedures into reusable skills.",
            "- Re-organize, refine, or relocate existing knowledge to maintain a high-quality codebase of capabilities.",
            "",
            "Management philosophy:",
            "- Be cautious with management actions. Your goal is to improve awareness and capability for future tasks.",
            "- Instead of permanently removing a skill that might still hold value, consider redefining it within its folder or moving it to a more appropriate ward.",
            "- Evolution of knowledge is preferred over flat deletion unless the skill is confirmed to be incorrect or entirely redundant.",
            ""
        ];

        if (this.config.dynamicSkillCreation) {
            promptLines.push(
                "When creation is allowed (strict gate):",
                "- Create a skill only after exploration confirms no same or meaningfully similar skill already exists.",
                "- Create a skill only after the agent has developed or validated a reusable process during the current task.",
                "- Do not create speculative, empty, or duplicate skills.",
                ""
            );
        }

        promptLines.push("Available management tools:");
        let toolIdx = 1;
        if (this.config.dynamicSkillCreation) {
            promptLines.push(
                `${toolIdx++}) skill_folder_create`,
                "   - Arguments: { folderName: string, folderLocation?: string }",
                "   - Creates a new skill ward/folder under folderLocation or root if omitted.",
                `${toolIdx++}) skill_file_create`,
                "   - Arguments: { skillFile: { fileName: string, type: skill|script|reference|documentation|assets, location: string, content: string }, inLocation?: string }",
                "   - Creates a file entry with content."
            );
        }

        if (this.config.dynamicSkillRemoval) {
            promptLines.push(
                `${toolIdx++}) skill_folder_remove`,
                "   - Arguments: { folderLocation: string }",
                "   - Recursively removes a ward/folder subtree.",
                `${toolIdx++}) skill_remove`,
                "   - Arguments: { skillLocation: string }",
                "   - Recursively removes a skill folder subtree."
            );
        }

        if (this.config.dynamicSkillRelocation) {
            promptLines.push(
                `${toolIdx++}) skill_relocate`,
                "   - Arguments: { fromLocation: string, toLocation: string }",
                "   - Relocates a skill or ward under target location."
            );
        }

        promptLines.push(
            "",
            "Exploration helpers available in the same runtime:",
            "- skill_folder_discover, skill_meta_read, skill_full_read.",
            "Use these before any modification for deduplication, and after for verification.",
            "",
            "How to manage (safe, universal workflow):",
            "- Discover target ward and potential duplicates before any write/remove/relocate call.",
            "- For a new skill, create a skill folder first, then create SKILL.md as the canonical skill file.",
            "- Use skill_file_create with type=skill and fileName=SKILL.md for the core definition.",
            "- Keep supporting files in scripts/references/assets/documentation with matching type values.",
            "- Ensure SKILL.md metadata/frontmatter is valid, specific, and useful for routing.",
            "- After each mutation, re-discover and re-read metadata/full skill to confirm expected state.",
            "- Do not perform destructive removal when target path is ambiguous.",
            "",
            "Execution policy:",
            "- Tool availability depends on runtime flags (dynamic creation/removal/relocation).",
            "- If a required tool is unavailable or returns false, report limitation and do not fabricate success.",
            "- Prefer minimal, reversible changes and keep skill structure coherent."
        );

        return promptLines.join("\n");
    }
    
    /** 
     * Create set of tools to read skills
     * Supportive for using the skills
    */
    createExploreSkillsAgentTools() {
        const { readSkillFull, readSkillMeta, discoverSkillFolder } = this.config.skillStorage;
        const toolsSet: Tool<any, any>[] = [];

        type DiscoverSkillFolderParams = Parameters<SchemaSkillStore["discoverSkillFolder"]>;
        type DiscoverSkillFolderArgs = { fromLocation?: DiscoverSkillFolderParams[0] };

        toolsSet.push(
            tool(
                async ({ fromLocation }) => {
                    const discoveredEntriesResult = await discoverSkillFolder(fromLocation);
                    this.emit("discoverSkillFolder", fromLocation);
                    return JSON.stringify(discoveredEntriesResult, null, 2);
                },
                {
                    toolName: "skill_folder_discover",
                    toolDescription: "Use to discover skill wards/subwards and skill-related files in a location.",
                    toolArguments: z.object({
                        fromLocation: z.string().optional().describe("Location where skills should be discovered. If omitted, root skill location is used.")
                    } satisfies Record<keyof DiscoverSkillFolderArgs, any>)
                }
            )
        );

        type ReadSkillMetaParams = Parameters<SchemaSkillStore["readSkillMeta"]>;
        type ReadSkillMetaArgs = { fromLocation?: ReadSkillMetaParams[0] };

        toolsSet.push(
            tool(
                async ({ fromLocation }) => {
                    const skillMetaResult = await readSkillMeta(fromLocation);
                    this.emit("readSkillMeta", fromLocation);
                    return String(skillMetaResult);
                },
                {
                    toolName: "skill_meta_read",
                    toolDescription: "Use to read only frontmatter metadata from SKILL.md.",
                    toolArguments: z.object({
                        fromLocation: z.string().optional().describe("Location of skill folder or SKILL.md file. If omitted, root is used.")
                    } satisfies Record<keyof ReadSkillMetaArgs, any>)
                }
            )
        );

        type ReadSkillFullParams = Parameters<SchemaSkillStore["readSkillFull"]>;
        type ReadSkillFullArgs = { fromLocation?: ReadSkillFullParams[0] };

        toolsSet.push(
            tool(
                async ({ fromLocation }) => {
                    const skillFullResult = await readSkillFull(fromLocation);
                    this.emit("readSkillFull", fromLocation);
                    return String(skillFullResult);
                },
                {
                    toolName: "skill_full_read",
                    toolDescription: "Use to read full SKILL.md content with metadata and instructions.",
                    toolArguments: z.object({
                        fromLocation: z.string().optional().describe("Location of skill folder or SKILL.md file. If omitted, root is used.")
                    } satisfies Record<keyof ReadSkillFullArgs, any>)
                }
            )
        );

        return toolsSet;
    }

    /** 
     * Create set of tools to make, manage skills
     * Supportive for creating/removing skills
    */
    createManageSkillAgentTools() {
        const { createSkillFile, createSkillFolder, reloacateSkill, removeSkill, removeSkillFolder } = this.config.skillStorage;
        const toolsSet: Tool<any, any>[] = [];

        if (this.config.dynamicSkillCreation) {
            // Folder
            type CreateSkillFolderParams = Parameters<SchemaSkillStore['createSkillFolder']>
            type CreateSkillFolderArgs = { folderName: CreateSkillFolderParams[0]; folderLocation: CreateSkillFolderParams[1] };

            toolsSet.push(
                tool(
                    async ({ folderName, folderLocation }) => {
                        const createFolderSkillsResult = await createSkillFolder(folderName, folderLocation);
                        this.emit("createSkillFolder", folderName, folderLocation);
                        return String(createFolderSkillsResult);
                    },
                    {
                        toolName: "skill_folder_create",
                        toolDescription: `Use to create skill folder where skills will be then placed. Skill folder is otherwise skill ward where then skills and subskills will be allocated`,
                        toolArguments: z.object({
                            folderName: z.string().describe("Name for folder where will be skills allocated"),
                            folderLocation: z.string().optional().describe("Location where folder has to be spawned. If not specified will be spawn in the root skills directory - use such condition to spawn the main skill wards")
                        } satisfies Record<keyof CreateSkillFolderArgs, any>)
                    }
                )
            );

            // File
            type CreateSkillParams = Parameters<SchemaSkillStore['createSkillFile']>
            type CreateSkillArgs = { skillFile: CreateSkillParams[0]; inLocation?: CreateSkillParams[1] };

            toolsSet.push(
                tool(
                    async ({ skillFile, inLocation }) => {
                        const createFolderSkillsResult = await createSkillFile(skillFile, inLocation);
                        this.emit("createSkillFile", skillFile, inLocation);
                        return String(createFolderSkillsResult);
                    },
                    {
                        toolName: "skill_file_create",
                        toolDescription: `Use to create skill file that is acutally the skill or one of skill type. It can be used to make the skill, script, reference, documentation, assets file of skill in the existsing skill folder`,
                        toolArguments: z.object({
                            skillFile: z.object({
                                fileName: z.string(),
                                type: z.enum(["skill", "script", "reference", "documentation", "assets"]),
                                location: z.string(),
                                content: z.string()
                            } satisfies Record<keyof SkillFileEntryWithContent, any>),
                            inLocation: z.string().optional().describe("Location where skill has to be spawned. If not specified will be spawn in the root skills directory - use such condition to spawn skills in root skills directory")
                        } satisfies Record<keyof CreateSkillArgs, any>)
                    }
                )
            );
        }

        if (this.config.dynamicSkillRemoval) {
            // Skill folder
            type RemoveSkillFolderParams = Parameters<SchemaSkillStore['removeSkillFolder']>
            type RemoveSkillFolderArgs = { folderLocation: RemoveSkillFolderParams[0] };

            toolsSet.push(
                tool(
                    async ({ folderLocation }) => {
                        const removeFolderSkillsResult = await removeSkillFolder(folderLocation);
                        this.emit("removeSkillFolder", folderLocation);
                        return String(removeFolderSkillsResult);
                    },
                    {
                        toolName: "skill_folder_remove",
                        toolDescription: `Use to remove skill folders with subfolders and skills are in this folder. Removes skill folder with subfolders and skills in this folder and subfolders. To avoid such behaviour relocate skills first to unaffected directories`,
                        toolArguments: z.object({
                            folderLocation: z.string().describe("Location where actually skill folder is"),
                        } satisfies Record<keyof RemoveSkillFolderArgs, any>)
                    }
                )
            );
            
            // Skill
            type RemoveSkillParams = Parameters<SchemaSkillStore['removeSkill']>
            type RemoveSkillArgs = { skillLocation: RemoveSkillParams[0] };

            toolsSet.push(
                tool(
                    async ({ skillLocation }) => {
                        const removeSkillResult = await removeSkill(skillLocation);
                        this.emit("removeSkill", skillLocation);
                        return String(removeSkillResult);
                    },
                    {
                        toolName: "skill_remove",
                        toolDescription: `Use to remove particular skill`,
                        toolArguments: z.object({
                            skillLocation: z.string().describe("Location where actually skill is / skill folder is"),
                        } satisfies Record<keyof RemoveSkillArgs, any>)
                    }
                )
            );
        }

        if (this.config.dynamicSkillRelocation) {
            type ReloParams = Parameters<SchemaSkillStore['reloacateSkill']>; // [string, string]
            type ReloArgs = { fromLocation: ReloParams[0]; toLocation: ReloParams[1] };

            toolsSet.push(
                tool(
                    async ({ fromLocation, toLocation }) => {
                        const relocateResult = await reloacateSkill(fromLocation, toLocation);
                        this.emit("reloacateSkill", fromLocation, toLocation);
                        return String(relocateResult);
                    },
                    {
                        toolName: "skill_relocate",
                        toolDescription: `Use to rellocate particular skills, skill wards (sets of skills = folders with multiple similar skills) and/or subwards (separate set of skills)`,
                        toolArguments: z.object({
                            fromLocation: z.string().describe("Location where actually skill is / skill folder is"),
                            toLocation: z.string().describe("Location where skill has to be put")
                        } satisfies Record<keyof ReloArgs, any>)
                    }
                )
            );
        }

        return toolsSet;
    }

    /**
     * TODO: Execute skill in sandbox and use hitl according to config
     * Set of tools to execute scripts of skills
    */
    createSkillScriptExecuteTools(): Tool<any, any>[] {
        const executeTools: Tool<any, any>[] = [];

        type ExecuteSkillScriptArgs = {
            scriptLocation: string;
            runtime?: SkillScriptRuntime;
            scriptArgs?: string[];
            workingDirectory?: string;
            timeoutMs?: number;
        };

        executeTools.push(
            tool(
                async ({ scriptLocation, runtime, scriptArgs, workingDirectory, timeoutMs }) => {
                    const resolvedScriptPath = this.resolveScriptPath(scriptLocation, workingDirectory);

                    if (!resolvedScriptPath) {
                        return JSON.stringify({
                            success: false,
                            error: `Script path could not be resolved: "${scriptLocation}"`,
                            scriptLocation
                        }, null, 2);
                    }

                    const preparedCommand = this.prepareScriptRuntimeCommand(
                        runtime ?? "auto",
                        resolvedScriptPath,
                        scriptArgs ?? []
                    );

                    if ("error" in preparedCommand) {
                        return JSON.stringify({
                            success: false,
                            error: preparedCommand.error,
                            scriptLocation,
                            resolvedScriptPath
                        }, null, 2);
                    }

                    const executionResult = await this.executeCommandLine(
                        preparedCommand.command,
                        preparedCommand.args,
                        {
                            timeoutMs,
                            workingDirectory: workingDirectory ?? path.dirname(resolvedScriptPath)
                        }
                    );

                    return JSON.stringify({
                        ...executionResult,
                        scriptLocation,
                        resolvedScriptPath,
                        runtime: runtime ?? "auto"
                    }, null, 2);
                },
                {
                    toolName: "skill_script_run",
                    toolDescription: "Use to execute a skill script file by location, with runtime autodetection or explicit runtime override.",
                    toolArguments: z.object({
                        scriptLocation: z.string().describe("Location/path to a script file to execute."),
                        runtime: z.enum(["auto", "node", "python", "powershell", "bash", "cmd"]).optional().describe("Script runtime. Defaults to auto-detection from file extension."),
                        scriptArgs: z.array(z.string()).optional().describe("Optional script arguments passed to the script."),
                        workingDirectory: z.string().optional().describe("Optional command working directory. Defaults to script folder."),
                        timeoutMs: z.number().int().min(1_000).max(300_000).optional().describe("Optional timeout in milliseconds. Default is 45_000.")
                    } satisfies Record<keyof ExecuteSkillScriptArgs, any>)
                }
            )
        );

        type ExecuteCLIArgs = {
            command: string;
            args?: string[];
            workingDirectory?: string;
            timeoutMs?: number;
        };

        executeTools.push(
            tool(
                async ({ command, args, workingDirectory, timeoutMs }) => {
                    const executionResult = await this.executeCommandLine(command, args ?? [], {
                        timeoutMs,
                        workingDirectory
                    });

                    return JSON.stringify(executionResult, null, 2);
                },
                {
                    toolName: "skill_cli_execute",
                    toolDescription: "Use to execute a direct command-line command when script wrappers or custom command invocations are needed.",
                    toolArguments: z.object({
                        command: z.string().describe("Executable/command name to run, such as node, python, bash, or npm."),
                        args: z.array(z.string()).optional().describe("Optional command arguments list."),
                        workingDirectory: z.string().optional().describe("Optional command working directory. Defaults to current process directory."),
                        timeoutMs: z.number().int().min(1_000).max(300_000).optional().describe("Optional timeout in milliseconds. Default is 45_000.")
                    } satisfies Record<keyof ExecuteCLIArgs, any>)
                }
            )
        );

        return executeTools;
    }

    /** It's list with numbers of available skills a agent can use
     * It's insert to each system prompt when skills interface is specified to inform user about skills and description of all available skills
     * 
     * ### How does it work?
     * 1. Explore skill folder
     * 2. Place the name of skill and description from skill meta after a hyphen
     */
    async getListOfAvailableSkillsString(): Promise<string> {
        const { readSkillMeta, discoverSkillFolder } = this.config.skillStorage;

        const buildTree = async (location?: string, indent = ""): Promise<string> => {
            const entries = await discoverSkillFolder(location);
            let tree = "";

            for (const entry of entries) {
                if ("folderName" in entry) {
                    if (entry.type === "skill") {
                        const meta = await readSkillMeta(entry.location);
                        const description = this.extractDescription(meta);
                        const truncatedDescription = description.length > 700 
                            ? description.slice(0, 700) + "..." 
                            : description;
                        tree += `${indent}- ${entry.folderName}${truncatedDescription ? ` - ${truncatedDescription}` : ""}\n`;
                    } else if (entry.type === "skill-ward") {
                        tree += `${indent}- (${entry.folderName})\n`;
                        tree += await buildTree(entry.location, indent + "   ");
                    }
                }
            }
            return tree;
        };

        const treeContent = await buildTree();
        const finalTree = `(Root Skills Directory)\n${treeContent || "- No skills found."}`;
        
        return `${finalTree}\n\n**How to interpret the tree:**\n- Items in parentheses e.g., \`(Folder Name)\` are skill wards (categories) that group multiple skills.\n- Items starting with a hyphen e.g., \`- Skill Name - Description\` are actual skills that you can use.\n- If a description ends with \`...\`, it has been truncated to conserve tokens. Use \`skill_full_read\` or \`skill_meta_read\` to see the complete information and instructions for that skill.`;
    }

    private extractDescription(meta: string): string {
        if (!meta) return "";
        // Simple regex to extract description from frontmatter
        const match = meta.match(/description:\s*(?:>|\|)?\s*([\s\S]*?)(?=\n\w+:|$)/);
        if (match && match[1]) {
            let desc = match[1].trim();
            // Remove YAML multiline markers and clean up
            desc = desc.replace(/^[|>]\s*\n?/, "").replace(/\n\s+/g, " ").trim();
            return desc;
        }
        return "";
    }

    private normalizeLocation(location?: string): string {
        if (!location) {
            return "";
        }

        return location
            .replace(/\\/g, "/")
            .replace(/^\/+/, "")
            .replace(/\/+$/, "");
    }

    private resolveScriptPath(scriptLocation: string, workingDirectory?: string): string | null {
        const normalizedScriptLocation = scriptLocation.trim();

        if (!normalizedScriptLocation.length) {
            return null;
        }

        const candidates = new Set<string>();
        const addCandidate = (candidatePath: string) => {
            candidates.add(path.resolve(candidatePath));
        };

        if (path.isAbsolute(normalizedScriptLocation)) {
            addCandidate(normalizedScriptLocation);
        }

        if (workingDirectory?.trim()) {
            addCandidate(path.join(workingDirectory, normalizedScriptLocation));
        }

        addCandidate(path.join(process.cwd(), normalizedScriptLocation));

        const normalizedSession = this.normalizeLocation(this.config.session);
        const skillsRoot = normalizedSession.length > 0
            ? path.join(process.cwd(), "skills", ...normalizedSession.split("/"))
            : path.join(process.cwd(), "skills");

        addCandidate(path.join(skillsRoot, normalizedScriptLocation));

        for (const candidatePath of candidates) {
            if (!fs.existsSync(candidatePath)) {
                continue;
            }

            if (!fs.statSync(candidatePath).isFile()) {
                continue;
            }

            return candidatePath;
        }

        return null;
    }

    private prepareScriptRuntimeCommand(
        runtime: SkillScriptRuntime,
        scriptPath: string,
        scriptArgs: string[]
    ): { command: string; args: string[] } | { error: string } {
        const normalizedRuntime = runtime.toLowerCase() as SkillScriptRuntime;

        if (normalizedRuntime !== "auto") {
            return this.prepareExplicitRuntimeCommand(normalizedRuntime, scriptPath, scriptArgs);
        }

        const extension = path.extname(scriptPath).toLowerCase();

        if ([".js", ".cjs", ".mjs"].includes(extension)) {
            return { command: "node", args: [scriptPath, ...scriptArgs] };
        }

        if (extension === ".py") {
            return { command: "python", args: [scriptPath, ...scriptArgs] };
        }

        if (extension === ".ps1") {
            return {
                command: "powershell",
                args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...scriptArgs]
            };
        }

        if (extension === ".sh") {
            return { command: "bash", args: [scriptPath, ...scriptArgs] };
        }

        if ([".cmd", ".bat"].includes(extension)) {
            return { command: "cmd", args: ["/c", scriptPath, ...scriptArgs] };
        }

        return {
            error: `Unsupported script extension "${extension || "<none>"}" for runtime=auto. Set explicit runtime or use skill_cli_execute.`
        };
    }

    private prepareExplicitRuntimeCommand(
        runtime: Exclude<SkillScriptRuntime, "auto">,
        scriptPath: string,
        scriptArgs: string[]
    ): { command: string; args: string[] } {
        if (runtime === "node") {
            return { command: "node", args: [scriptPath, ...scriptArgs] };
        }

        if (runtime === "python") {
            return { command: "python", args: [scriptPath, ...scriptArgs] };
        }

        if (runtime === "powershell") {
            return {
                command: "powershell",
                args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...scriptArgs]
            };
        }

        if (runtime === "bash") {
            return { command: "bash", args: [scriptPath, ...scriptArgs] };
        }

        return { command: "cmd", args: ["/c", scriptPath, ...scriptArgs] };
    }

    private getExecutionTimeout(timeoutMs?: number): number {
        if (!Number.isFinite(timeoutMs)) {
            return 45_000;
        }

        const numericTimeout = Number(timeoutMs);

        return Math.min(300_000, Math.max(1_000, Math.floor(numericTimeout)));
    }

    private appendProcessOutput(
        currentValue: string,
        chunk: string,
        maxLength = 24_000
    ): { value: string; truncated: boolean } {
        if (currentValue.length >= maxLength) {
            return { value: currentValue, truncated: true };
        }

        const allowedChunkLength = maxLength - currentValue.length;
        const clippedChunk = chunk.slice(0, allowedChunkLength);
        const nextValue = `${currentValue}${clippedChunk}`;

        return {
            value: nextValue,
            truncated: clippedChunk.length < chunk.length
        };
    }

    /**
     * TODO: Cover this with config changes
     * 1. Provide to it sandbox to allow toe execute the skills in isolated environment out of the device
     * 2. Allow to use hitl there to always make user bee decidive
     */
    private async executeCommandLine(
        command: string,
        args: string[],
        options: {
            workingDirectory?: string;
            timeoutMs?: number;
        }
    ): Promise<CommandExecutionResult> {
        const trimmedCommand = command.trim();
        const cwd = options.workingDirectory?.trim().length
            ? path.resolve(options.workingDirectory)
            : process.cwd();

        if (!trimmedCommand.length) {
            return {
                success: false,
                command: trimmedCommand,
                args,
                cwd,
                exitCode: null,
                timedOut: false,
                stdout: "",
                stderr: "",
                truncatedStdout: false,
                truncatedStderr: false,
                error: "Command cannot be empty."
            };
        }

        if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
            return {
                success: false,
                command: trimmedCommand,
                args,
                cwd,
                exitCode: null,
                timedOut: false,
                stdout: "",
                stderr: "",
                truncatedStdout: false,
                truncatedStderr: false,
                error: `Working directory does not exist or is not a directory: "${cwd}"`
            };
        }

        const timeout = this.getExecutionTimeout(options.timeoutMs);

        return new Promise<CommandExecutionResult>((resolve) => {
            let stdout = "";
            let stderr = "";
            let truncatedStdout = false;
            let truncatedStderr = false;
            let timedOut = false;

            const child = spawn(trimmedCommand, args, {
                cwd,
                shell: false,
                windowsHide: true
            });

            const timeoutHandle = setTimeout(() => {
                timedOut = true;
                child.kill();
            }, timeout);

            child.stdout?.on("data", (chunk) => {
                const appendResult = this.appendProcessOutput(stdout, String(chunk));
                stdout = appendResult.value;
                truncatedStdout = truncatedStdout || appendResult.truncated;
            });

            child.stderr?.on("data", (chunk) => {
                const appendResult = this.appendProcessOutput(stderr, String(chunk));
                stderr = appendResult.value;
                truncatedStderr = truncatedStderr || appendResult.truncated;
            });

            child.on("error", (error) => {
                clearTimeout(timeoutHandle);

                resolve({
                    success: false,
                    command: trimmedCommand,
                    args,
                    cwd,
                    exitCode: null,
                    timedOut,
                    stdout,
                    stderr,
                    truncatedStdout,
                    truncatedStderr,
                    error: error.message
                });
            });

            child.on("close", (exitCode) => {
                clearTimeout(timeoutHandle);

                resolve({
                    success: !timedOut && exitCode === 0,
                    command: trimmedCommand,
                    args,
                    cwd,
                    exitCode,
                    timedOut,
                    stdout,
                    stderr,
                    truncatedStdout,
                    truncatedStderr,
                    error: timedOut ? `Command timed out after ${timeout}ms.` : undefined
                });
            });
        });
    }
    
    get api() {
        return this.config.skillStorage;
    }
}
