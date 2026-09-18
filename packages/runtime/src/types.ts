export interface AgentTool {
    name: string;
    description: string;

    parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };

    execute(
        args: Record<string, any>,
        context: string
    ): Promise<string>;
}